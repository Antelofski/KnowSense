'use client';

import { useState } from 'react';

const colorClasses = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
};

export default function FeedbackPanel({
  feedbacks,
  expandedFeedbackId,
  hoveredSegmentId,
  hoveredFeedbackId,
  feedbackColorMap = new Map(),
  onExpandFeedback,
  onEnrichFeedback,
  onSelectEnrichedFeedback,
  onCancelEnrichFeedback,
  enrichingFeedbackId,
  onHoverFeedback,
  onDeleteFeedback,
  mappingLoading = false,
}) {
  const [selectedOptions, setSelectedOptions] = useState({});

  const handleSelectOption = (feedbackId, optionIndex) => {
    setSelectedOptions((prev) => {
      const prevIndices = prev[feedbackId] || [];
      const set = new Set(prevIndices);
      if (set.has(optionIndex)) {
        set.delete(optionIndex);
      } else {
        set.add(optionIndex);
      }
      return {
        ...prev,
        [feedbackId]: Array.from(set),
      };
    });
  };

  return (
    <div className="space-y-4 text-[15px] md:text-base">
      {feedbacks.map((feedback) => {
        const isHovered = hoveredFeedbackId === feedback.id;
        const isLinkedToSegment = hoveredSegmentId
          ? feedback.relatedSegments?.includes(hoveredSegmentId)
          : false;

        return (
        <div
          key={feedback.id}
          onMouseEnter={() => onHoverFeedback?.(feedback.id)}
          onMouseLeave={() => onHoverFeedback?.(null)}
          className={`bg-white border rounded-xl p-4 shadow-sm transition-all relative ${
            isHovered || isLinkedToSegment
              ? 'border-yellow-400 shadow-[0_0_0_2px_rgba(250,204,21,0.6)] bg-yellow-50'
              : 'border-gray-300'
          }`}
        >
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <button
              onClick={() => onEnrichFeedback?.(feedback.id)}
              disabled={enrichingFeedbackId === feedback.id || mappingLoading}
              className="p-1.5 text-indigo-500 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-full hover:bg-indigo-50 transition-colors"
              title={mappingLoading ? 'Analyzing relations…' : enrichingFeedbackId === feedback.id ? 'Generating...' : 'Enrich feedback'}
            >
              {enrichingFeedbackId === feedback.id ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M5 19l4-4m6-10l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M11 7l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            <button
              onClick={() => onDeleteFeedback?.(feedback.id)}
              disabled={enrichingFeedbackId === feedback.id || mappingLoading}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={mappingLoading ? 'Analyzing relations, delete disabled temporarily' : enrichingFeedbackId === feedback.id ? 'Enriching feedback, delete disabled temporarily' : 'Delete this feedback'}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="flex items-start gap-3 pr-10">
            {/* 颜色标记圆圈 - 使用 feedbackColorMap 中的颜色，如果没有对应关系则用灰色 */}
            <div
              className={`w-4 h-4 rounded-full shrink-0 mt-1 ${
                feedbackColorMap.has(feedback.id)
                  ? colorClasses[feedbackColorMap.get(feedback.id)] || 'bg-gray-500'
                  : 'bg-gray-400'
              }`}
            />
            
            {/* 评语内容 - 只显示text，不再显示title */}
            <div className="flex-1">
              <p className="text-gray-800 mb-2 whitespace-pre-line">
                {feedback.text}
              </p>
              
              {/* 生成的评语选项 */}
              {expandedFeedbackId === feedback.id && feedback.expandedOptions?.length > 0 && (
                <div className="mt-3 space-y-2 pl-2 border-l-2 border-orange-300">
                  {feedback.expandedOptions.map((option, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 transition-colors"
                    >
                      {/** 兼容字符串或对象两种形式的选项 */}
                      {(() => {
                        const displayText =
                          typeof option === 'string' ? option : option.text;
                        const checked =
                          (selectedOptions[feedback.id] || []).includes(index);
                        return (
                          <>
                            <input
                              type="checkbox"
                              name={`feedback-option-${feedback.id}`}
                              id={`option-${feedback.id}-${index}`}
                              checked={checked}
                              onChange={() =>
                                handleSelectOption(feedback.id, index)
                              }
                              className="mt-1 w-4 h-4 text-orange-600 border-gray-300 focus:ring-orange-500"
                            />
                            <label
                              htmlFor={`option-${feedback.id}-${index}`}
                              className="flex-1 text-sm text-gray-700 cursor-pointer"
                            >
                              {displayText}
                            </label>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  
                  {/* 选择和取消按钮 */}
                  <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
                    <button
                      onClick={() => {
                        const selectedIndex = selectedOptions[feedback.id];
                        if (
                          selectedIndex !== null &&
                          selectedIndex !== undefined &&
                          Array.isArray(selectedIndex) &&
                          selectedIndex.length > 0
                        ) {
                          setSelectedOptions((prev) => {
                            const next = { ...prev };
                            delete next[feedback.id];
                            return next;
                          });
                          onSelectEnrichedFeedback?.(
                            feedback.id,
                            selectedIndex
                          );
                        }
                      }}
                      disabled={
                        !Array.isArray(selectedOptions[feedback.id]) ||
                        selectedOptions[feedback.id].length === 0
                      }
                      className="px-3 py-1.5 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => {
                        setSelectedOptions(prev => {
                          const next = { ...prev };
                          delete next[feedback.id];
                          return next;
                        });
                        onCancelEnrichFeedback?.(feedback.id);
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )})}
    </div>
  );
}

