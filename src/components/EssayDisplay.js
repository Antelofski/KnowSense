'use client';

import { useEffect, useRef } from 'react';

// 颜色对应荧光笔高亮背景
const colorClasses = {
  green: 'bg-green-200',
  red: 'bg-red-200',
  blue: 'bg-blue-200',
  orange: 'bg-orange-200',
};

export default function EssayDisplay({
  essay,
  hoveredSegmentId,
  hoveredFeedbackSegmentIds = [],
  segmentColorMap = new Map(),
  feedbackColorMap = new Map(),
  hoveredFeedbackId = null,
  onHoverSegment,
}) {
  const segmentRefs = useRef({});

  // 当悬浮评语时，自动滚动到对应的段落
  useEffect(() => {
    if (hoveredFeedbackSegmentIds.length > 0) {
      const firstSegmentId = hoveredFeedbackSegmentIds[0];
      const element = segmentRefs.current[firstSegmentId];
      if (element) {
        // 找到最近的滚动容器（左侧文章面板）
        const scrollContainer = element.closest('.overflow-auto, .overflow-y-auto') || 
                                element.closest('[class*="overflow"]') ||
                                element.offsetParent;
        
        if (scrollContainer && scrollContainer !== document.body) {
          // 计算元素相对于滚动容器的位置
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const scrollTop = scrollContainer.scrollTop;
          const targetScrollTop = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
          
          scrollContainer.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth',
          });
        } else {
          // 如果没有找到滚动容器，使用默认的 scrollIntoView
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest',
          });
        }
      }
    }
  }, [hoveredFeedbackSegmentIds]);

  return (
    <div className="text-gray-800 leading-relaxed text-[15px] md:text-base">
      {essay.segments.map((segment, index) => {
        const isLinkedToHoveredFeedback = hoveredFeedbackSegmentIds.includes(segment.id);
        // 如果当前段落被hover的评语关联，使用该评语的颜色（确保一对一）
        // 否则使用段落原本分配的颜色
        let segmentColor = null;
        if (isLinkedToHoveredFeedback && hoveredFeedbackId && feedbackColorMap.has(hoveredFeedbackId)) {
          // 使用hover的评语的颜色
          segmentColor = feedbackColorMap.get(hoveredFeedbackId);
        } else {
          // 使用段落原本分配的颜色
          segmentColor = segmentColorMap.get(segment.id);
        }
        const shouldShowHighlight = isLinkedToHoveredFeedback && segmentColor;
        
        return (
          <span
            key={segment.id}
            ref={(el) => {
              if (el) segmentRefs.current[segment.id] = el;
            }}
            onMouseEnter={() => onHoverSegment?.(segment.id)}
            onMouseLeave={() => onHoverSegment?.(null)}
            className={`${
              shouldShowHighlight ? colorClasses[segmentColor] || '' : ''
            } px-1 py-0.5 rounded-sm transition-all duration-200 ${
              isLinkedToHoveredFeedback ? 'shadow-[0_0_0_2px_rgba(251,191,36,0.8)]' : ''
            }`}
          >
            {segment.text}
            {index !== essay.segments.length - 1 && ' '}
          </span>
        );
      })}
    </div>
  );
}

