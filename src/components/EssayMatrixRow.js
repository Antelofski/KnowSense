'use client';

import { memo } from 'react';
import ExpandedEssayView from './ExpandedEssayView';

const EssayMatrixRow = memo(function EssayMatrixRow({
  workIndex,
  work,
  checklistStatus,
  checklistItems,
  getChecklistItemColor,
  isExpanded,
  canExpand,
  onToggleExpand,
  essayParts,
  feedbackMappings,
  parsedEssay,
  allFeedbacks,
  hoveredBlockKey,
  hoveredPartId,
  hoveredSegmentIds,
  tooltipPosition,
  partRefs,
  onSetHoveredBlockKey,
  onSetHoveredPartId,
  onSetHoveredSegmentIds,
  onSetTooltipPosition,
  clickedBlockKey,
  onSetClickedBlockKey,
  clickedPartIds,
  onSetClickedPartIds,
  activePartId,
  onSetActivePartId,
  activeSegmentIds,
  onSetActiveSegmentIds,
  isFeedbackMode = false,
}) {
  // 默认颜色函数
  const defaultGetChecklistItemColor = (itemId) => {
    const colors = [
      { bg: '#3b82f6', border: '#2563eb' },
      { bg: '#10b981', border: '#059669' },
      { bg: '#f59e0b', border: '#d97706' },
      { bg: '#ef4444', border: '#dc2626' },
      { bg: '#8b5cf6', border: '#7c3aed' },
      { bg: '#ec4899', border: '#db2777' },
      { bg: '#06b6d4', border: '#0891b2' },
      { bg: '#84cc16', border: '#65a30d' },
      { bg: '#f97316', border: '#ea580c' },
      { bg: '#6366f1', border: '#4f46e5' },
    ];
    return colors[(itemId - 1) % colors.length];
  };
  
  const getColor = getChecklistItemColor || defaultGetChecklistItemColor;
  return (
    <div className="space-y-2">
      {/* 矩阵行 */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `50px repeat(${checklistItems.length}, 1fr) 60px` }}
      >
        {/* 左侧：文章编号标识 + 展开按钮 */}
        <div 
          className={`flex items-center justify-center gap-1 text-xs font-medium p-2 rounded border-2 ${
            canExpand 
              ? 'text-slate-600 border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100' 
              : 'text-slate-400 border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
          }`} 
          onClick={() => canExpand && onToggleExpand(workIndex)}
        >
          <button
            type="button"
            disabled={!canExpand}
            className={`transition-colors ${canExpand ? 'text-slate-500 hover:text-slate-700' : 'text-slate-300 cursor-not-allowed'}`}
            title={canExpand ? (isExpanded ? 'Collapse' : 'Expand') : 'Segmentation not completed, cannot expand'}
          >
            <svg 
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className={`text-xs font-semibold ${canExpand ? '' : 'text-slate-400'}`}>#{workIndex + 1}</div>
        </div>
        
        {/* 右侧：知识清单项状态 */}
        {checklistStatus.map(({ id, satisfied, isPositive, isNegative }) => {
          const color = getColor(id);
          const blockKey = `${workIndex}-${id}`;
          const isClicked = clickedBlockKey === blockKey;
          const cell = checklistStatus.find((s) => s.id === id) || {};
          const paragraphIds = cell.paragraphIds || [];
          const cellFeedbackId = cell.feedbackId;
          const isOuterAlreadyClicked =
            clickedBlockKey === blockKey && clickedPartIds && clickedPartIds.size > 0;
          // 在 feedback mode 下，根据 isPositive 和 isNegative 显示符号
          const showSentiment = isFeedbackMode && satisfied;
          const sentimentSymbol = showSentiment ? (isPositive ? '+' : isNegative ? '-' : null) : null;
          return (
            <div
              key={id}
              className="border border-slate-200 rounded bg-white relative overflow-hidden"
              style={{
                boxShadow: isClicked
                  ? `0 0 0 2px ${color.bg}CC, 0 0 0 4px ${color.border}AA, 0 0 12px 6px ${color.border}70`
                  : 'none',
                zIndex: isClicked ? 20 : 1,
              }}
            >
              {satisfied ? (
                <div
                  draggable
                  className="w-full h-full rounded cursor-pointer hover:opacity-80 transition-all relative flex items-center justify-center"
                  style={{
                    backgroundColor: isClicked ? color.bg : color.bg,
                    borderColor: color.border,
                    borderWidth: '0',
                    backgroundImage: isClicked 
                      ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)'
                      : 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                    filter: isClicked ? 'brightness(1.2) saturate(1.3)' : 'none',
                  }}
                  onDragStart={(e) => {
                    // 在文章矩阵模式下：source=essay，携带 paragraphIds
                    // 在评论矩阵模式下（isFeedbackMode=true）：source=feedback，携带代表性的 feedbackId
                    const isFeedbackSource = !!isFeedbackMode && !!cellFeedbackId;
                    const payload = {
                      kind: 'matrix-block',
                      source: isFeedbackSource ? 'feedback' : 'essay',
                      workIndex,
                      checklistId: id,
                      feedbackId: isFeedbackSource ? cellFeedbackId : undefined,
                      paragraphIds,
                      label: isFeedbackSource
                        ? `Feedback-#${workIndex + 1}-C${id}`
                        : `Essay-#${workIndex + 1}-C${id}`,
                    };
                    const json = JSON.stringify(payload);
                    e.dataTransfer.setData('application/json', json);
                    e.dataTransfer.setData('text/plain', json);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();

                    // 外层色块点击逻辑：
                    // - 如果当前已是选中状态：外层点击 = 取消选中 + 收起展开区域
                    // - 否则：保持原有行为 = 选中并（必要时）展开
                    if (isOuterAlreadyClicked) {
                      // 取消选中（清空所有高亮/激活状态）
                      onSetClickedBlockKey(null);
                      onSetClickedPartIds(new Set());
                      onSetActivePartId(null);
                      onSetActiveSegmentIds(new Set());

                      // 外层点击额外收起当前文章的展开区域
                      if (canExpand && isExpanded) {
                        onToggleExpand(workIndex);
                      }
                      return;
                    }

                    // 原有逻辑：先展开，再设置选中
                    if (canExpand && !isExpanded) {
                      onToggleExpand(workIndex);
                    }
                    onSetClickedBlockKey(blockKey);

                    // 根据当前 checklist 对应的 paragraphIds 来定位 part 和高亮段落
                    if (!paragraphIds || paragraphIds.length === 0) {
                      return;
                    }

                    // 找出包含这些段落的第一个 part
                    let targetPartId = null;
                    for (const part of essayParts) {
                      if (
                        Array.isArray(part.paragraph_ids) &&
                        part.paragraph_ids.some((pid) =>
                          paragraphIds.includes(pid)
                        )
                      ) {
                        targetPartId = part.id;
                        break;
                      }
                    }

                    if (targetPartId != null) {
                      const partKey = `${workIndex}-${targetPartId}`;
                      onSetClickedPartIds(new Set([targetPartId]));
                      onSetActivePartId(partKey);
                      onSetActiveSegmentIds(new Set(paragraphIds));
                    }
                  }}
                >
                  {sentimentSymbol && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-white text-2xl font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                        {sentimentSymbol}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">-</div>
              )}
            </div>
          );
        })}
        {/* 右侧通用宽度占位列（保持与表头对齐） */}
        <div />
      </div>
      
      {/* 展开后的内容 */}
      {isExpanded && essayParts.length > 0 && (
        <ExpandedEssayView
          workIndex={workIndex}
          essayParts={essayParts}
          parsedEssay={parsedEssay}
          feedbackMappings={feedbackMappings}
          checklistItems={checklistItems}
          allFeedbacks={allFeedbacks}
          hoveredBlockKey={hoveredBlockKey}
          hoveredPartId={hoveredPartId}
          hoveredSegmentIds={hoveredSegmentIds}
          tooltipPosition={tooltipPosition}
          partRefs={partRefs}
          onSetHoveredBlockKey={onSetHoveredBlockKey}
          onSetHoveredPartId={onSetHoveredPartId}
          onSetHoveredSegmentIds={onSetHoveredSegmentIds}
          onSetTooltipPosition={onSetTooltipPosition}
          getChecklistItemColor={getColor}
          clickedBlockKey={clickedBlockKey}
          clickedPartIds={clickedPartIds}
          activePartKey={activePartId}
          activeSegmentIds={activeSegmentIds}
          onSetClickedBlockKey={onSetClickedBlockKey}
          onSetClickedPartIds={onSetClickedPartIds}
          onSetActivePartKey={onSetActivePartId}
          onSetActiveSegmentIds={onSetActiveSegmentIds}
          essayChecklistStatus={checklistStatus}
          isFeedbackMode={isFeedbackMode}
        />
      )}
    </div>
  );
});

export default EssayMatrixRow;

