'use client';

import { memo } from 'react';

const FeedbackMatrixRow = memo(function FeedbackMatrixRow({
  workIndex,
  feedbackId,
  feedbackText,
  feedbackTitle,
  checklistStatus,
  checklistItems,
  getChecklistItemColor,
  hoveredFeedbackLabel,
  feedbackTooltipPosition,
  onMouseEnter,
  onMouseLeave,
  onCellHover,
  onCellLeave,
}) {
  const fullFeedbackText = [feedbackTitle, feedbackText].filter(Boolean).join('\n');
  const feedbackDisplayText = fullFeedbackText || 'No feedback content';
  const labelKey = `${workIndex}-${feedbackId}`;
  const isHovered = hoveredFeedbackLabel === labelKey;

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `80px repeat(${checklistItems.length}, 1fr) 60px` }}
    >
      {/* 左侧：评论标识 */}
      <div 
        className="flex flex-col items-center justify-center text-xs text-slate-600 font-medium p-2 rounded border-2 border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors relative"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="text-[10px] text-slate-500">Essay{workIndex + 1}</div>
        <div className="text-xs font-semibold">Comment{feedbackId}</div>
        
        {/* 悬浮提示 */}
        {isHovered && (
          <div className="fixed z-99999 w-80 max-w-[90vw] p-3 bg-slate-900 text-white text-xs rounded shadow-xl pointer-events-none"
            style={{
              left: `${feedbackTooltipPosition.x}px`,
              top: `${feedbackTooltipPosition.y}px`,
            }}
          >
            <div className="font-semibold mb-2">Comment{feedbackId} - Essay{workIndex + 1}</div>
            {feedbackTitle && (
              <div className="font-medium mb-1 text-indigo-300">{feedbackTitle}</div>
            )}
            <div className="whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto">
              {feedbackText || 'No feedback content'}
            </div>
          </div>
        )}
      </div>
      
      {/* 右侧：知识清单项状态 */}
      {checklistStatus.map(({ id, satisfied }) => {
        const color = getChecklistItemColor(id);
        const paragraphIds = checklistStatus.find((s) => s.id === id)?.paragraphIds || [];
        return (
          <div
            key={id}
            className="aspect-square border border-slate-200 rounded bg-white relative overflow-hidden"
            title={
              satisfied
                ? `Essay${workIndex + 1}: ${feedbackDisplayText}\n\nSatisfies ${checklistItems.find((c) => c.id === id)?.name || `C${id}`}`
                : `Essay${workIndex + 1}: ${feedbackDisplayText}\n\nDoes not satisfy ${checklistItems.find((c) => c.id === id)?.name || `C${id}`}`
            }
            >
            {satisfied ? (
              <div
                draggable
                className="w-full h-full rounded cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: color.bg,
                  borderColor: color.border,
                  borderWidth: '1px',
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                }}
                onDragStart={(e) => {
                  const payload = {
                    kind: 'matrix-block',
                    source: 'feedback',
                    workIndex,
                    checklistId: id,
                    feedbackId,
                    paragraphIds,
                    // 这里直接标明是 Feedback 来源
                    label: `Feedback-#${workIndex + 1}-C${id}`,
                  };
                  const json = JSON.stringify(payload);
                  e.dataTransfer.setData('application/json', json);
                  e.dataTransfer.setData('text/plain', json);
                }}
                  onMouseEnter={() => {
                    if (onCellHover) {
                      onCellHover(workIndex, feedbackId, id, paragraphIds, feedbackDisplayText);
                    }
                  }}
                  onMouseLeave={() => {
                    if (onCellLeave) {
                      onCellLeave();
                    }
                  }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">-</div>
            )}
          </div>
        );
      })}
      {/* 右侧通用宽度占位列（保持与表头对齐） */}
      <div />
    </div>
  );
});

export default FeedbackMatrixRow;

