/**
 * hooks/useDayData.js
 * ===================
 * 
 * 自定义 React Hook: 封装"加载某日数据"的整个生命周期。
 * 
 * 核心特性:
 * - 切换日期时, 旧数据保留在内存 (不闪屏)
 * - 新数据加载完成才平滑替换
 * - 加载失败自动回退到上一个成功的日期
 * - 暴露细粒度状态: loading / loadingProgress / error / data
 * 
 * 用法:
 *   const dayState = useDayData("perth", "2026-03-11");
 *   dayState.data       // 当前显示的数据 (可能是旧的, 加载中也保留)
 *   dayState.loading    // 是否正在加载新日期
 *   dayState.progress   // 加载进度 0-1
 *   dayState.stage      // 加载阶段文字
 *   dayState.error      // 错误信息 (null 表示无错)
 */

import { useEffect, useRef, useState } from "react";
import { loadDay } from "../data/loader.js";


export function useDayData(source, date) {
  // data 保留旧值, 直到新数据加载成功才替换
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  
  // 跟踪"上次成功加载的 date" - 用于错误回退
  const lastSuccessDateRef = useRef(null);
  
  // 跟踪当前请求的 token, 防止竞态 (用户快速切换日期)
  const requestTokenRef = useRef(0);
  
  
  useEffect(() => {
    if (!source || !date) return;
    
    // 如果当前 data 已经是这个 date, 不重复加载
    if (data && data.date === date && data.source === source) {
      return;
    }
    
    // 用新 token 标记本次请求,旧请求的回调会被忽略
    const myToken = ++requestTokenRef.current;
    
    setLoading(true);
    setProgress(0);
    setStage("Starting...");
    setError(null);
    
    loadDay(source, date, (st, p) => {
      // 进度回调: 如果本请求已经被新请求替代,忽略
      if (requestTokenRef.current !== myToken) return;
      setStage(st);
      setProgress(p);
    })
      .then((dayData) => {
        if (requestTokenRef.current !== myToken) return;  // 已经被替代
        
        setData(dayData);
        setLoading(false);
        setProgress(1);
        setError(null);
        lastSuccessDateRef.current = date;
      })
      .catch((err) => {
        if (requestTokenRef.current !== myToken) return;
        
        console.error("Failed to load day:", err);
        setError(err.message || String(err));
        setLoading(false);
        // 注意: 不清除 data, 让 UI 仍然显示旧数据
      });
  }, [source, date]);
  
  
  return {
    data,
    loading,
    progress,
    stage,
    error,
    lastSuccessDate: lastSuccessDateRef.current,
  };
}