/**
 * render/particles.js
 * ===================
 * 
 * 粒子模拟器 (Step 4.1 - 带拖尾历史)。
 * 
 * 相对前一版本的改变:
 * - 每个粒子保留最近 TRAIL_LENGTH 步的位置历史
 * - step() 输出"分段列表" segments[]: 每段一对 [lon, lat] + 颜色 + alpha
 * - 重生时清空 history,避免出现"瞬移线段"
 */


// 拖尾保留多少步.
// 在 60fps 下: 40 步 ≈ 0.67 秒视觉残影,搭配 3500× speedFactor
// 在 zoom=7-9 地图上能看见明显的丝带状拖尾。
const TRAIL_LENGTH = 40;

// 生命周期淡入淡出 (单位: tick)
// 粒子的 alpha 因子曲线:
//   age 0..FADE_IN_FRAMES: alpha 0→1 (诞生)
//   FADE_IN_FRAMES..maxAge-FADE_OUT_FRAMES: alpha=1 (成熟期)
//   maxAge-FADE_OUT_FRAMES..maxAge: alpha 1→0 (消亡)
// FADE_OUT 比 FADE_IN 长很多, 让消亡过程足够"温柔",每帧 alpha 变化 < 3%
const FADE_IN_FRAMES = 10;
const FADE_OUT_FRAMES = 40;


// ============================================================
// 单点采样 (双线性插值)
// ============================================================
// skipLandMask: 
//   false (默认, 海洋流场) - 4 个角点里有任何陆地格子就返回 null,
//                            粒子不能进陆地.
//   true  (大气风场)       - 忽略 mask, 陆地上也插值.
//                            因为风在陆地上是有意义的物理量.
function sampleUV(u, v, mask, nEta, nXi, bounds, lon, lat, skipLandMask = false) {
  if (lon < bounds.minLon || lon > bounds.maxLon ||
      lat < bounds.minLat || lat > bounds.maxLat) {
    return null;
  }
  
  const fx = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * (nXi - 1);
  const fy = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * (nEta - 1);
  
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, nXi - 1);
  const y1 = Math.min(y0 + 1, nEta - 1);
  
  if (x0 < 0 || x0 >= nXi - 1 || y0 < 0 || y0 >= nEta - 1) return null;
  
  const tx = fx - x0;
  const ty = fy - y0;
  
  const i00 = y0 * nXi + x0;
  const i10 = y0 * nXi + x1;
  const i01 = y1 * nXi + x0;
  const i11 = y1 * nXi + x1;
  
  // 海洋模式: 任一角点是陆地 -> 不可用. 大气模式: 跳过这个检查.
  if (!skipLandMask) {
    if (mask[i00] === 0 || mask[i10] === 0 ||
        mask[i01] === 0 || mask[i11] === 0) return null;
  }
  
  const u00 = u[i00], u10 = u[i10], u01 = u[i01], u11 = u[i11];
  const v00 = v[i00], v10 = v[i10], v01 = v[i01], v11 = v[i11];
  
  if (!Number.isFinite(u00) || !Number.isFinite(u10) ||
      !Number.isFinite(u01) || !Number.isFinite(u11)) return null;
  
  const u0 = u00 * (1 - tx) + u10 * tx;
  const u1 = u01 * (1 - tx) + u11 * tx;
  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  
  return {
    u: u0 * (1 - ty) + u1 * ty,
    v: v0 * (1 - ty) + v1 * ty,
  };
}


// ============================================================
// 重生
// ============================================================
// ⭐ spawn 粒子: 从真实的海洋格子列表里随机选, 用 polygon 的中心点作为 lon/lat。
//
// 为什么不能按 (row, col) 用 bounds 线性插值反推 lon/lat:
//   ROMS 是曲线网格, 不是经纬度对齐的均匀矩形.
//   在 Perth 这种小范围域 (70km), 误差很小 (网格几乎是矩形).
//   在 CWA 这种大范围域 (1300km), 误差可达几十公里, 会把粒子扔到陆地上.
//
// 用 oceanCells 的 polygon 角点平均值作为格子中心, 是几何上正确的位置.
function spawnParticle(oceanCells) {
  const cell = oceanCells[Math.floor(Math.random() * oceanCells.length)];
  // polygon 是 4 个角点 [[lon0,lat0], [lon1,lat1], [lon2,lat2], [lon3,lat3]]
  // 取对角线中点 = 矩形中心 (近似)
  const poly = cell.polygon;
  const lon = (poly[0][0] + poly[2][0]) * 0.5;
  const lat = (poly[0][1] + poly[2][1]) * 0.5;
  return {
    lon, lat,
    history: [],
    age: 0,
    lastSpeed: 0,
    lastU: 0,
    lastV: 0,
  };
}


// ============================================================
// 速度 → RGB (alpha 由调用方根据段位置计算)
// ============================================================
// maxSpeed: 归一化上限. speed 达到这个值就是色带最右端 (红).
//   - 海洋流场: 1.0 m/s  (洋流典型 0-1 m/s)
//   - 大气风场: 12.0 m/s (风速典型 0-12+ m/s)
function speedToRGB(speed, maxSpeed = 1.0) {
  const t = Math.max(0, Math.min(1, speed / maxSpeed));
  
  const stops = [
    { t: 0.0,  c: [56, 189, 248] },
    { t: 0.35, c: [96, 165, 250] },
    { t: 0.6,  c: [250, 204, 21] },
    { t: 0.85, c: [251, 146, 60] },
    { t: 1.0,  c: [239, 68,  68] },
  ];
  
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * localT),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * localT),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * localT),
      ];
    }
  }
  return stops[stops.length - 1].c;
}


// ============================================================
// 粒子模拟器
// ============================================================
export class ParticleSimulator {
  constructor({ uvFrame, bounds, oceanCells, nParticles = 1400, trailLength, kind = "ocean" }) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    this.oceanCells = oceanCells;     // 格子列表 (海洋源=海洋格子, 大气源=全部格子)
    // ⭐ kind: "ocean" (海洋流场) | "atmosphere" (大气风场)
    //   ocean:      粒子撞陆地立刻死, 不能上岸 (洋流物理)
    //   atmosphere: 粒子可自由穿过陆地 (风在陆地上也存在)
    this.kind = kind;
    // 速度配色归一化上限: 海洋 1 m/s, 大气 12 m/s
    this.speedColorMax = (kind === "atmosphere") ? 12.0 : 1.0;
    this.particles = Array.from({ length: nParticles }, () =>
      spawnParticle(oceanCells)
    );
    this.maxAge = 180;
    this.trailLength = trailLength ?? TRAIL_LENGTH;
  }
  
  updateUVFrame(uvFrame) {
    this.uvFrame = uvFrame;
  }
  
  reset(uvFrame, bounds, oceanCells) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    if (oceanCells) this.oceanCells = oceanCells;
    this.particles = this.particles.map(() => spawnParticle(this.oceanCells));
  }
  
  setParticleCount(n) {
    const current = this.particles.length;
    if (n > current) {
      for (let i = 0; i < n - current; i++) {
        this.particles.push(spawnParticle(this.oceanCells));
      }
    } else if (n < current) {
      this.particles.length = n;
    }
  }
  
  // ⭐ 允许运行时调节拖尾长度 (CWA 范围大需要长拖尾才看得见)
  setTrailLength(n) {
    this.trailLength = Math.max(10, Math.min(200, n));
  }
  
  /**
   * 推进一步。返回:
   * - segments: 拖尾线段列表 (每段 = 1 对相邻历史点 + 颜色)
   * - heads: 头部点列表 (每个粒子当前位置)
   */
  step(dtSeconds, speedFactor, baseAlpha) {
    const { uvFrame, bounds, oceanCells, particles, maxAge, trailLength, kind } = this;
    const { u, v, mask, nEta, nXi } = uvFrame;
    
    // ⭐ 大气风场: 粒子可以在陆地上自由移动 (风在陆地有值)
    //    海洋流场: 粒子撞陆地要死 (洋流不上岸)
    const isAtmosphere = (kind === "atmosphere");
    
    const simSeconds = dtSeconds * speedFactor;
    const segments = [];
    const heads = [];
    
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      // 已经"死透"了 (age 超过 maxAge): 真正重生
      if (p.age >= maxAge) {
        const np = spawnParticle(oceanCells);
        p.lon = np.lon; p.lat = np.lat;
        p.history = []; p.age = 0; p.lastSpeed = 0;
        p.lastU = 0; p.lastV = 0;
        continue;
      }
      
      // 采样: 大气模式传 skipLandMask=true, 陆地上也能取到风速
      const sampled = sampleUV(
        u, v, mask, nEta, nXi, bounds, p.lon, p.lat, isAtmosphere
      );
      
      // 判断当前是否应该处于"加速死亡"状态
      // 触发条件: 出界, 速度过小, 或即将出界
      // 注意: 撞陆地相关的逻辑 (hitLand/probe) 只对海洋模式生效.
      let triggerDying = false;
      let canMove = false;     // 这一帧能正常移动吗?
      let curU = 0, curV = 0;  // 这一帧要用的 u/v
      let hitLand = false;     // 撞陆地? 只有海洋模式才会触发
      
      if (!sampled) {
        // sampled 为 null:
        //   海洋模式 = 撞陆地或出界 -> 立刻死透
        //   大气模式 = 只可能是出界 (陆地不再返回 null) -> 触发 dying
        triggerDying = true;
        if (!isAtmosphere) {
          hitLand = true;      // 海洋: 当前位置就在陆地, 立刻死透
        } else {
          // ⭐ 大气: 粒子已经在框外了 (出界). 清零速度, 就地停住淡出,
          //   不让它带着惯性继续往框外漂.
          p.lastU = 0; p.lastV = 0;
        }
      } else {
        const speed = Math.sqrt(sampled.u * sampled.u + sampled.v * sampled.v);
        if (speed < 0.005) {
          triggerDying = true;
        } else {
          const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
          const dLat = (sampled.v * simSeconds) / 111320;
          const dLon = (sampled.u * simSeconds) / (111320 * cosLat);
          const newLon = p.lon + dLon;
          const newLat = p.lat + dLat;
          
          if (newLon < bounds.minLon || newLon > bounds.maxLon ||
              newLat < bounds.minLat || newLat > bounds.maxLat) {
            // ⭐ 即将出界: 触发 dying, 但【本帧不再推进】(canMove=false).
            //   粒子停在当前 (仍在框内的) 位置, 原地淡出消失, 然后重生.
            //
            //   旧逻辑是"继续按方向漂出去再淡出" —— 对慢速的洋流没问题
            //   (漂一点点就淡没了), 但对风 (速度快 ~10 倍) 会冲出框外
            //   很远才淡完, 看起来像粒子"漏"到了数据范围外面.
            //
            //   注意: 不设 curU/curV, 也不更新 lastU/lastV —— 这样下面
            //   "dying 且 canMove=false 时用 lastU/lastV 继续漂"那段
            //   逻辑也不会把它推出去 (lastU/lastV 保持上一帧的值, 但
            //   triggerDying 分支只在 lastU/lastV 非零时才漂, 而我们
            //   这里希望它就地停住, 所以也把 lastU/lastV 清零).
            triggerDying = true;
            canMove = false;
            p.lastU = 0; p.lastV = 0;
            p.lastSpeed = speed;
          } else if (!isAtmosphere) {
            // ⭐ 海洋模式: 预测下一步位置, 如果落在陆地, 触发立刻死透
            // 防止粒子"跨越"岛屿 (CWA 2km 网格 + 高速因子下,
            // 一帧位移可能比小岛宽, 越岛后又活了)
            const probe = sampleUV(u, v, mask, nEta, nXi, bounds, newLon, newLat, false);
            if (!probe) {
              // 一步会撞陆: 这一帧推进到边缘后立刻死透
              triggerDying = true;
              hitLand = true;
              canMove = true;
              curU = sampled.u; curV = sampled.v;
              p.lastU = sampled.u; p.lastV = sampled.v;
              p.lastSpeed = speed;
            } else {
              // 一切正常, 推进
              canMove = true;
              curU = sampled.u; curV = sampled.v;
              p.lastU = sampled.u; p.lastV = sampled.v;
              p.lastSpeed = speed;
            }
          } else {
            // ⭐ 大气模式: 不检查陆地, 直接推进 (风穿过陆地是正常的)
            canMove = true;
            curU = sampled.u; curV = sampled.v;
            p.lastU = sampled.u; p.lastV = sampled.v;
            p.lastSpeed = speed;
          }
        }
      }
      
      // 触发 dying: 把 age 推到 maxAge - FADE_OUT_FRAMES
      if (triggerDying && p.age < maxAge - FADE_OUT_FRAMES) {
        p.age = maxAge - FADE_OUT_FRAMES;
      }
      
      // ⭐ 撞陆: 立刻死透 (跳过 dying 阶段, 不漂)
      //    history 也清空, 不留拖尾在陆地上
      //    注意: hitLand 只可能在海洋模式被置 true, 大气模式永远走不到这里
      if (hitLand) {
        p.age = maxAge;        // 下一帧 step 进来会被 respawn
        p.history = [];        // 清空已记录的拖尾
        p.lastU = 0; p.lastV = 0;
        continue;              // 跳过本帧推进, 不要画
      }
      
      // dying 状态且 canMove=false 时, 如果还残留 lastU/lastV,
      // 用它让粒子继续漂动一会儿 (惯性衰减).
      // 注: 出界粒子现在会把 lastU/lastV 清零 (见上方出界分支),
      //     所以出界粒子不会进这里 —— 它们就地停住淡出. 这个分支
      //     现在主要是防御性的, 覆盖其它可能的 canMove=false 情形.
      if (triggerDying && !canMove && (p.lastU !== 0 || p.lastV !== 0)) {
        canMove = true;
        curU = p.lastU; curV = p.lastV;
        p.lastU *= 0.96; p.lastV *= 0.96;
      }
      
      // 实际推进
      if (canMove) {
        const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
        const dLat = (curV * simSeconds) / 111320;
        const dLon = (curU * simSeconds) / (111320 * cosLat);
        const newLon = p.lon + dLon;
        const newLat = p.lat + dLat;
        
        // 健康粒子: 推 history + 移动
        // dying + 出界粒子: 也可以正常推 (反正快消失了)
        p.history.push([p.lon, p.lat]);
        if (p.history.length > trailLength) p.history.shift();
        p.lon = newLon;
        p.lat = newLat;
      }
      
      p.age++;
      
      // ----- 计算生命周期 alpha 因子 -----
      let lifeAlpha = 1.0;
      if (p.age < FADE_IN_FRAMES) {
        // 淡入: 0..1
        lifeAlpha = p.age / FADE_IN_FRAMES;
      } else if (p.age > maxAge - FADE_OUT_FRAMES) {
        // 淡出: 1..0
        const remaining = maxAge - p.age;
        lifeAlpha = Math.max(0, remaining / FADE_OUT_FRAMES);
      }
      // 平滑曲线 (smoothstep): 让淡入淡出更柔和,避免线性看起来"硬"
      lifeAlpha = lifeAlpha * lifeAlpha * (3 - 2 * lifeAlpha);
      
      // 完全透明的粒子跳过渲染
      if (lifeAlpha < 0.02) continue;
      
      // ----- 生成渲染数据 -----
      const speed = p.lastSpeed;
      // 用 speedColorMax 归一化 (海洋 1 m/s, 大气 12 m/s)
      const rgb = speedToRGB(speed, this.speedColorMax);
      // 粗细也按归一化速度算, 否则风速(0-15)会让所有粒子都顶格 min(2.0)
      const speedNorm = Math.min(1, speed / this.speedColorMax);
      const widthHead = 0.8 + speedNorm * 1.2;  // 0.8 ~ 2.0
      
      const hist = p.history;
      const histLen = hist.length;
      
      if (histLen >= 1) {
        // ⭐ 简化逻辑: 不再"逐段吃掉",所有段都画出来,
        // 但每段 alpha 都乘以 lifeAlpha (整条丝带统一淡入淡出)
        // 这样消失过程是 alpha 平滑下降, 没有段数离散变化的"啪"。
        for (let s = 0; s < histLen; s++) {
          const t = (s + 1) / histLen;
          const trailAlpha = t * t;
          
          // 段 alpha = baseAlpha × 拖尾位置因子 × 生命周期因子
          const alpha = Math.round(baseAlpha * trailAlpha * lifeAlpha);
          
          const start = hist[s];
          const end = (s + 1 < histLen) ? hist[s + 1] : [p.lon, p.lat];
          
          if (alpha < 2) continue;  // alpha 极小才跳过
          
          segments.push({
            sourcePosition: start,
            targetPosition: end,
            color: [rgb[0], rgb[1], rgb[2], alpha],
            width: widthHead * (0.5 + 0.5 * t),
          });
        }
      }
      
      // 头部点跟 lifeAlpha 同步淡入淡出
      heads.push({
        position: [p.lon, p.lat],
        color: [rgb[0], rgb[1], rgb[2], Math.round(baseAlpha * lifeAlpha)],
        radius: 0.9 + speedNorm * 1.7,  // 0.9 ~ 2.6, 按归一化速度
      });
    }
    
    return { segments, heads };
  }
}