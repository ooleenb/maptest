/**
 * data/decoder.js
 * ===============
 * 
 * 把原始字节流 / 图像解码成 JS 友好的数据结构。
 * 
 * 两种数据格式:
 * 1. 标量场 (temp/salt/zeta): Float32 二进制 → Float32Array
 * 2. 矢量场 (u/v): PNG (RGBA) → 两个 Float32Array + mask
 */

import { DEBUG } from "./config.js";

// ============================================================
// 标量场解码: ArrayBuffer → Float32Array
// ============================================================
/**
 * 把 ArrayBuffer 解码成 Float32Array,并提供按帧切片的接口。
 * 
 * @param {ArrayBuffer} arrayBuffer  从 API 拿到的字节流
 * @param {number[]} shape  数组形状, 例如 [24, 259, 129]
 * @returns {{
 *   data: Float32Array,         // 完整扁平数据 (length = 24*259*129)
 *   shape: number[],            // [24, 259, 129]
 *   nFrames: number,
 *   nEta: number,
 *   nXi: number,
 *   frameSize: number,          // 每帧的元素数 (259*129)
 *   getFrame: (i) => Float32Array  // 取第 i 帧的"视图"(零拷贝)
 * }}
 */
export function decodeScalarBuffer(arrayBuffer, shape) {
  const data = new Float32Array(arrayBuffer);
  
  if (shape.length !== 3) {
    throw new Error(`Expected 3D shape, got ${shape.length}D`);
  }
  const [nFrames, nEta, nXi] = shape;
  const frameSize = nEta * nXi;
  
  // 校验字节数对得上
  const expectedLength = nFrames * frameSize;
  if (data.length !== expectedLength) {
    throw new Error(
      `Scalar buffer length mismatch: got ${data.length} floats, ` +
      `expected ${expectedLength} (${nFrames}×${nEta}×${nXi})`
    );
  }
  
  if (DEBUG) {
    console.log(
      `[decoder] decoded scalar: ${nFrames}×${nEta}×${nXi}, ` +
      `${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`
    );
  }
  
  return {
    data,
    shape,
    nFrames,
    nEta,
    nXi,
    frameSize,
    /**
     * 取第 i 帧的 Float32Array 视图。
     * 注意: 这是"视图"而不是拷贝, 极快, 但修改它会改原数据。
     * 通常我们只读, 所以无所谓。
     */
    getFrame(i) {
      if (i < 0 || i >= nFrames) {
        throw new Error(`Frame index ${i} out of range [0, ${nFrames})`);
      }
      return data.subarray(i * frameSize, (i + 1) * frameSize);
    },
  };
}


// ============================================================
// PNG 解码: URL → ImageData → 解析出 u/v/mask
// ============================================================
/**
 * 从 URL 加载 PNG 并解码出 u, v, mask 三个数组。
 * 
 * 编码规则 (与 prep_day.py 的 _encode_uv_to_png 一致):
 *   R = (u + uv_range) / (2 * uv_range) * 255
 *   G = (v + uv_range) / (2 * uv_range) * 255
 *   B = mask * 255   (1=有效海洋, 0=陆地/无效)
 *   A = 255 (不用)
 * 
 * ⭐ 重要设计 (修复 WRF 陆地无风的 bug):
 *   decoder 始终保留 R/G 通道解码出的"真实 u/v 值", 不再因为
 *   B===0 就把 u/v 抹成 NaN. mask 数组单独保留 0/1 信息.
 *   
 *   为什么:
 *   - ROMS (海洋): 陆地格子 PNG 里 R/G 编码的是占位值, 但 mask=0.
 *     particles.js 海洋模式靠 mask 检查杀死上岸粒子, 不靠 NaN.
 *   - WRF (大气): 陆地格子 PNG 里 R/G 编码的是【真实风速】(WRF 陆地
 *     有风), 只是 mask=0 (mask 来自 ROMS 风格的 land mask).
 *     如果这里把 u/v 抹成 NaN, 真实风速就丢了, 风粒子无法上陆地.
 *   
 *   把"要不要理会 mask"的决定权交给下游 (particles.js 按 kind 区分):
 *   decoder 只负责忠实解码, 不做业务判断.
 * 
 * @param {string} url  PNG URL
 * @param {number} uvRange  归一化范围 (从 meta.json 拿)
 * @returns {Promise<{
 *   u: Float32Array,       // 解码后的真实 u 值 (m/s), 长度 = nEta*nXi
 *   v: Float32Array,       // 解码后的真实 v 值 (m/s)
 *   mask: Uint8Array,      // 1=有效(海洋), 0=陆地. u/v 本身始终是有效数值.
 *   nEta: number,
 *   nXi: number,
 * }>}
 */
export function decodeUVPng(url, uvRange) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // 必须设置 crossOrigin, 否则跨域加载的 PNG 不能读 pixel
    // (这要求服务器返回 CORS 头,我们已经在 FastAPI 配好了)
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      try {
        const { width, height } = img;
        const nXi = width;
        const nEta = height;
        const n = nEta * nXi;
        
        // 把图像画到离屏 canvas, 然后读 pixel 数据
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const rgba = imageData.data; // Uint8ClampedArray, 长度 = n*4
        
        // 分配输出数组
        const u = new Float32Array(n);
        const v = new Float32Array(n);
        const mask = new Uint8Array(n);
        
        // 解码: 反归一化
        // ⭐ 始终解码 R/G 出真实 u/v, 不再因 B===0 抹成 NaN.
        //    mask 单独记录 0/1, 由下游决定是否理会.
        const scale = (2 * uvRange) / 255;
        for (let i = 0; i < n; i++) {
          const idx4 = i * 4;
          const r = rgba[idx4];
          const g = rgba[idx4 + 1];
          const b = rgba[idx4 + 2];
          
          // R/G 通道始终解码出数值 (海洋格子是真实流速,
          // ROMS 陆地格子是占位值, WRF 陆地格子是真实风速)
          u[i] = r * scale - uvRange;
          v[i] = g * scale - uvRange;
          // mask: B 通道 > 127 表示"海洋有效格子"
          mask[i] = (b > 127) ? 1 : 0;
        }
        
        if (DEBUG) {
          console.log(
            `[decoder] decoded PNG ${url.split("/").pop()}: ` +
            `${nEta}×${nXi}, uvRange=±${uvRange}`
          );
        }
        
        resolve({ u, v, mask, nEta, nXi });
      } catch (err) {
        reject(new Error(`PNG decode failed: ${err.message}`));
      }
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load PNG: ${url}`));
    };
    
    img.src = url;
  });
}


// ============================================================
// 工具: 在 Float32Array 里取 2D 索引
// ============================================================
/**
 * 给定一个扁平化的 2D 数组 (shape [nEta, nXi]),
 * 取 (row, col) 位置的值。
 */
export function get2D(flatArray, nXi, row, col) {
  return flatArray[row * nXi + col];
}