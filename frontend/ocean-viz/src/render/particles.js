/**
 * render/particles.js
 * ===================
 * 
 * 粒子动画模拟器 (CPU 实现)。
 * 
 * 输入: u/v 矢量场 (来自 PNG 解码) + 网格边界
 * 输出: 每帧的"线段列表"和"头部点列表",喂给 DeckGL LineLayer/ScatterplotLayer
 * 
 * 算法:
 *   - 双线性插值采样 u/v
 *   - 欧拉积分推进粒子位置
 *   - 边界外或速度过小时重置粒子
 *   - 用 cos(lat) 修正经度方向的米→度换算
 * 
 * 性能:
 *   - 1400 粒子 60fps 在桌面 Chrome 上完全没压力
 *   - 阶段 4 会用 WebGL shader 换成 GPU 版本,粒子数可上万
 */


// ============================================================
// 单点采样: 在 u/v 网格上做双线性插值
// ============================================================
/**
 * 在 ROMS 原始网格 (nEta × nXi) 上采样 u/v。
 * 用经纬度等距近似 (对 Perth 域 < 1° 跨度误差 <0.1%, 视觉无差异)。
 */
function sampleUV(u, v, mask, nEta, nXi, bounds, lon, lat) {
  // 边界检查
  if (lon < bounds.minLon || lon > bounds.maxLon ||
      lat < bounds.minLat || lat > bounds.maxLat) {
    return null;
  }
  
  // 浮点网格坐标
  const fx = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * (nXi - 1);
  const fy = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * (nEta - 1);
  
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, nXi - 1);
  const y1 = Math.min(y0 + 1, nEta - 1);
  
  if (x0 < 0 || x0 >= nXi - 1 || y0 < 0 || y0 >= nEta - 1) {
    return null;
  }
  
  const tx = fx - x0;
  const ty = fy - y0;
  
  // 4 个角点的扁平索引
  const i00 = y0 * nXi + x0;
  const i10 = y0 * nXi + x1;
  const i01 = y1 * nXi + x0;
  const i11 = y1 * nXi + x1;
  
  // 检查 4 个角点都是海洋
  if (mask[i00] === 0 || mask[i10] === 0 ||
      mask[i01] === 0 || mask[i11] === 0) {
    return null;
  }
  
  // 双线性插值
  const u00 = u[i00], u10 = u[i10], u01 = u[i01], u11 = u[i11];
  const v00 = v[i00], v10 = v[i10], v01 = v[i01], v11 = v[i11];
  
  if (!Number.isFinite(u00) || !Number.isFinite(u10) ||
      !Number.isFinite(u01) || !Number.isFinite(u11)) {
    return null;
  }
  
  const u0 = u00 * (1 - tx) + u10 * tx;
  const u1 = u01 * (1 - tx) + u11 * tx;
  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  
  const uVal = u0 * (1 - ty) + u1 * ty;
  const vVal = v0 * (1 - ty) + v1 * ty;
  
  return { u: uVal, v: vVal };
}


// ============================================================
// 在有效海洋点上随机生成一个粒子
// ============================================================
function spawnParticle(uvFrame, bounds) {
  const { u, v, mask, nEta, nXi } = uvFrame;
  
  // 尝试 60 次找到一个有效采样点
  for (let attempt = 0; attempt < 60; attempt++) {
    const row = Math.floor(Math.random() * nEta);
    const col = Math.floor(Math.random() * nXi);
    const idx = row * nXi + col;
    
    if (mask[idx] === 1 && Number.isFinite(u[idx]) && Number.isFinite(v[idx])) {
      // 网格索引 -> 经纬度
      const lon = bounds.minLon + (col / (nXi - 1)) * (bounds.maxLon - bounds.minLon);
      const lat = bounds.minLat + (row / (nEta - 1)) * (bounds.maxLat - bounds.minLat);
      return { lon, lat, prevLon: lon, prevLat: lat, age: 0 };
    }
  }
  
  // 兜底: 域内随机位置 (可能落在陆地, 但下一帧会被重置)
  const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
  return { lon, lat, prevLon: lon, prevLat: lat, age: 0 };
}


// ============================================================
// 粒子配色: 流速大小映射到颜色
// ============================================================
function speedToColor(speed, alpha = 200) {
  const t = Math.max(0, Math.min(1, speed / 1.0));  // 0-1 m/s 映射到 0-1
  
  // 浅蓝 → 蓝 → 黄 → 橙 → 红
  const stops = [
    { t: 0.0,  color: [56, 189, 248] },   // 浅蓝
    { t: 0.35, color: [96, 165, 250] },   // 蓝
    { t: 0.6,  color: [250, 204, 21] },   // 黄
    { t: 0.85, color: [251, 146, 60] },   // 橙
    { t: 1.0,  color: [239, 68, 68] },    // 红
  ];
  
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.color[0] + (b.color[0] - a.color[0]) * localT),
        Math.round(a.color[1] + (b.color[1] - a.color[1]) * localT),
        Math.round(a.color[2] + (b.color[2] - a.color[2]) * localT),
        alpha,
      ];
    }
  }
  return [...stops[stops.length - 1].color, alpha];
}


// ============================================================
// 粒子模拟器: 主类
// ============================================================
export class ParticleSimulator {
  constructor({ uvFrame, bounds, nParticles = 1400 }) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    this.particles = Array.from({ length: nParticles }, () =>
      spawnParticle(uvFrame, bounds)
    );
    this.maxAge = 80;  // 粒子最多存活 80 帧后重置 (避免长期"堆积"在低流速区)
  }
  
  // 切换 u/v 帧 (小时变化时), 粒子位置保持
  updateUVFrame(uvFrame) {
    this.uvFrame = uvFrame;
  }
  
  // 重置所有粒子 (切换日期时)
  reset(uvFrame, bounds) {
    this.uvFrame = uvFrame;
    this.bounds = bounds;
    this.particles = this.particles.map(() => spawnParticle(uvFrame, bounds));
  }
  
  // 改变粒子总数
  setParticleCount(n) {
    const current = this.particles.length;
    if (n > current) {
      // 添加新粒子
      for (let i = 0; i < n - current; i++) {
        this.particles.push(spawnParticle(this.uvFrame, this.bounds));
      }
    } else if (n < current) {
      this.particles.length = n;
    }
  }
  
  /**
   * 推进一步。
   * 
   * @param {number} dtSeconds 真实时间 dt (秒)
   * @param {number} speedFactor 视觉加速因子 (默认 1600, 即 1 秒动画 = 1600 秒物理时间)
   * @param {number} alpha 0-255
   * @returns {{ segments: Array, heads: Array }}
   *   segments: 给 LineLayer 用
   *   heads:    给 ScatterplotLayer 用
   */
  step(dtSeconds, speedFactor, alpha) {
    const { uvFrame, bounds, particles, maxAge } = this;
    const { u, v, mask, nEta, nXi } = uvFrame;
    
    const simSeconds = dtSeconds * speedFactor;
    const segments = [];
    const heads = [];
    
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      // 采样当前位置的 u/v
      const sampled = sampleUV(u, v, mask, nEta, nXi, bounds, p.lon, p.lat);
      if (!sampled) {
        // 在陆地/边界外, 重生
        const newP = spawnParticle(uvFrame, bounds);
        p.lon = newP.lon; p.lat = newP.lat;
        p.prevLon = newP.prevLon; p.prevLat = newP.prevLat;
        p.age = 0;
        continue;
      }
      
      const speed = Math.sqrt(sampled.u * sampled.u + sampled.v * sampled.v);
      
      // 速度过小或粒子寿命到, 重生
      if (speed < 0.005 || p.age >= maxAge) {
        const newP = spawnParticle(uvFrame, bounds);
        p.lon = newP.lon; p.lat = newP.lat;
        p.prevLon = newP.prevLon; p.prevLat = newP.prevLat;
        p.age = 0;
        continue;
      }
      
      // 欧拉积分: 球面近似, 用 cos(lat) 修正经度方向
      const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
      const dLat = (sampled.v * simSeconds) / 111320;
      const dLon = (sampled.u * simSeconds) / (111320 * cosLat);
      
      const newLon = p.lon + dLon;
      const newLat = p.lat + dLat;
      
      // 边界外, 重生
      if (newLon < bounds.minLon || newLon > bounds.maxLon ||
          newLat < bounds.minLat || newLat > bounds.maxLat) {
        const newP = spawnParticle(uvFrame, bounds);
        p.lon = newP.lon; p.lat = newP.lat;
        p.prevLon = newP.prevLon; p.prevLat = newP.prevLat;
        p.age = 0;
        continue;
      }
      
      // 更新位置
      p.prevLon = p.lon;
      p.prevLat = p.lat;
      p.lon = newLon;
      p.lat = newLat;
      p.age++;
      
      // 输出渲染数据
      const color = speedToColor(speed, alpha);
      const width = Math.min(2.2, 0.8 + speed * 0.9);
      
      segments.push({
        sourcePosition: [p.prevLon, p.prevLat],
        targetPosition: [p.lon, p.lat],
        color,
        width,
      });
      
      heads.push({
        position: [p.lon, p.lat],
        color,
        radius: Math.min(2.8, 1.0 + speed * 1.2),
      });
    }
    
    return { segments, heads };
  }
}