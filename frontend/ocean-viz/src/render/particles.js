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
function sampleUV(u, v, mask, nEta, nXi, bounds, lon, lat) {
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
  
  if (mask[i00] === 0 || mask[i10] === 0 ||
      mask[i01] === 0 || mask[i11] === 0) return null;
  
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
function spawnParticle(uvFrame, bounds) {
  const { u, v, mask, nEta, nXi } = uvFrame;
  
  for (let attempt = 0; attempt < 60; attempt++) {
    const row = Math.floor(Math.random() * nEta);
    const col = Math.floor(Math.random() * nXi);
    const idx = row * nXi + col;
    
    if (mask[idx] === 1 && Number.isFinite(u[idx]) && Number.isFinite(v[idx])) {
      const lon = bounds.minLon + (col / (nXi - 1)) * (bounds.maxLon - bounds.minLon);
      const lat = bounds.minLat + (row / (nEta - 1)) * (bounds.maxLat - bounds.minLat);
      return {
        lon, lat,
        history: [],
        age: 0,
        lastSpeed: 0,
        lastU: 0,
        lastV: 0,
      };
    }
  }
  
  const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
  return { lon, lat, history: [], age: 0, lastSpeed: 0, lastU: 0, lastV: 0 };
}


// ============================================================
// 速度 → RGB (alpha 由调用方根据段位置计算)
// ============================================================
function speedToRGB(speed) {
  const t = Math.max(0, Math.min(1, speed / 1.0));
  
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
  constructor({ uvFrame, bounds, nParticles = 1400 }) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    this.particles = Array.from({ length: nParticles }, () =>
      spawnParticle(uvFrame, bounds)
    );
    this.maxAge = 180;  // 总寿命: ~3 秒。配合 FADE_OUT=40, 成熟期约 130 帧 (2 秒)
    this.trailLength = TRAIL_LENGTH;
  }
  
  updateUVFrame(uvFrame) {
    this.uvFrame = uvFrame;
  }
  
  reset(uvFrame, bounds) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    this.particles = this.particles.map(() => spawnParticle(uvFrame, bounds));
  }
  
  setParticleCount(n) {
    const current = this.particles.length;
    if (n > current) {
      for (let i = 0; i < n - current; i++) {
        this.particles.push(spawnParticle(this.uvFrame, this.bounds));
      }
    } else if (n < current) {
      this.particles.length = n;
    }
  }
  
  /**
   * 推进一步。返回:
   * - segments: 拖尾线段列表 (每段 = 1 对相邻历史点 + 颜色)
   * - heads: 头部点列表 (每个粒子当前位置)
   */
  step(dtSeconds, speedFactor, baseAlpha) {
    const { uvFrame, bounds, particles, maxAge, trailLength } = this;
    const { u, v, mask, nEta, nXi } = uvFrame;
    
    const simSeconds = dtSeconds * speedFactor;
    const segments = [];
    const heads = [];
    
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      // 已经"死透"了 (age 超过 maxAge): 真正重生
      if (p.age >= maxAge) {
        const np = spawnParticle(uvFrame, bounds);
        p.lon = np.lon; p.lat = np.lat;
        p.history = []; p.age = 0; p.lastSpeed = 0;
        p.lastU = 0; p.lastV = 0;
        continue;
      }
      
      const sampled = sampleUV(u, v, mask, nEta, nXi, bounds, p.lon, p.lat);
      
      // 判断当前是否应该处于"加速死亡"状态
      // 触发条件: 出界, 流速过小, 或即将出界
      let triggerDying = false;
      let canMove = false;     // 这一帧能正常移动吗?
      let curU = 0, curV = 0;  // 这一帧要用的 u/v
      
      if (!sampled) {
        triggerDying = true;
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
            // 即将出界: 触发 dying, 但本帧依然按这个方向推进 (漂出去)
            triggerDying = true;
            canMove = true;
            curU = sampled.u; curV = sampled.v;
            p.lastU = sampled.u; p.lastV = sampled.v;
            p.lastSpeed = speed;
          } else {
            // 一切正常,推进
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
      
      // ⭐ 关键: dying 状态如果 canMove=false (例如出界后陆地上),
      // 用上次记录的 lastU/lastV 让粒子继续漂动,
      // 这样头部点不静止,丝带会和健康粒子一样"流出画面"
      if (triggerDying && !canMove && (p.lastU !== 0 || p.lastV !== 0)) {
        canMove = true;
        curU = p.lastU; curV = p.lastV;
        // dying 时速度衰减一点点 (每帧 ×0.96), 看起来像"减速消失"
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
      const rgb = speedToRGB(speed);
      const widthHead = Math.min(2.0, 0.8 + speed * 0.7);
      
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
        radius: Math.min(2.6, 0.9 + speed * 1.0),
      });
    }
    
    return { segments, heads };
  }
}