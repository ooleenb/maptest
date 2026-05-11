/**
 * hooks/usePlayback.js
 * ====================
 * 
 * 自动播放 hook (v2 - 消除震颤版)。
 * 
 * 设计原则:
 * --------
 * 播放期间唯一权威源是内部的 ref, 不再从 React 状态回读。
 * 这避免了 "useEffect 同步 ref 时存在异步窗口" 导致的震颤。
 * 
 * Hook 返回一个 setHourFloat 函数,调用方应该用它替代直接 setState。
 * 这样无论谁改 hourFloat (滑块、播放、初始化), 都会同步更新 ref。
 * 
 * 用法:
 * ----
 *   const { hourFloat, setHourFloat, isPlaying, togglePlay } = usePlayback({
 *     initialHour: 0,
 *     maxHour: 23,
 *     speed: 2,        // 每秒走 2 小时
 *   });
 *   
 *   <input value={hourFloat} onChange={e => setHourFloat(+e.target.value)} />
 */

import { useEffect, useRef, useState, useCallback } from "react";


export function usePlayback({ initialHour = 0, maxHour = 23, speed = 2 }) {
  // React 状态: 用于渲染
  const [hourFloat, _setHourFloat] = useState(initialHour);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // ref: 用于动画循环内部的"真值"
  const hourRef = useRef(initialHour);
  const speedRef = useRef(speed);
  const maxHourRef = useRef(maxHour);
  const playingRef = useRef(false);  // 同步标志, 比 state 更快可读
  
  const animRef = useRef(null);
  const lastTsRef = useRef(null);
  
  // 跟踪 speed 和 maxHour (允许动态调整)
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { maxHourRef.current = maxHour; }, [maxHour]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  
  
  // ⭐ 关键: 统一的 setter
  // 不管是滑块还是动画, 都通过这个函数改 hourFloat,
  // 同时同步更新 ref —— 这样从动画的角度看, ref 始终是最新的。
  const setHourFloat = useCallback((newValue) => {
    // 防止越界
    let v = newValue;
    if (v < 0) v = 0;
    if (v > maxHourRef.current) v = maxHourRef.current;
    
    hourRef.current = v;     // 同步给 ref
    _setHourFloat(v);        // 同步给 React
  }, []);
  
  
  // 动画循环
  useEffect(() => {
    if (!isPlaying) {
      // 停止
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      lastTsRef.current = null;
      return;
    }
    
    const tick = (timestamp) => {
      // 如果在某一帧切换了播放状态(关闭), 立刻停
      if (!playingRef.current) return;
      
      // 首帧初始化 lastTs
      if (lastTsRef.current == null) {
        lastTsRef.current = timestamp;
        animRef.current = requestAnimationFrame(tick);
        return;
      }
      
      // 计算 dt, 限制最大值避免标签页切换回来时大跳
      let dt = (timestamp - lastTsRef.current) / 1000;
      if (dt > 0.1) dt = 0.1;
      lastTsRef.current = timestamp;
      
      // 推进 (ref 是权威)
      let newHour = hourRef.current + dt * speedRef.current;
      
      // 绕回开头
      if (newHour > maxHourRef.current) {
        newHour = newHour - maxHourRef.current;
      }
      
      // 同步两边
      hourRef.current = newHour;
      _setHourFloat(newHour);
      
      animRef.current = requestAnimationFrame(tick);
    };
    
    animRef.current = requestAnimationFrame(tick);
    
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      lastTsRef.current = null;
    };
  }, [isPlaying]);
  
  
  // 切换播放/暂停
  const togglePlay = useCallback(() => {
    setIsPlaying(p => !p);
  }, []);
  
  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  
  
  return {
    hourFloat,
    setHourFloat,
    isPlaying,
    togglePlay,
    play,
    pause,
  };
}