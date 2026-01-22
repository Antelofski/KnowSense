'use client';

import { useState, useRef } from 'react';

// 阶段二独立的颜色池
const phase2Colors = ['green', 'red', 'blue', 'orange', 'purple', 'yellow', 'pink'];

const colorClasses = {
  green: 'bg-green-400',
  red: 'bg-red-400',
  blue: 'bg-blue-400',
  orange: 'bg-orange-400',
  purple: 'bg-purple-400',
  yellow: 'bg-yellow-400',
  pink: 'bg-pink-400',
};

const colorBorders = {
  green: 'border-green-600',
  red: 'border-red-600',
  blue: 'border-blue-600',
  orange: 'border-orange-600',
  purple: 'border-purple-600',
  yellow: 'border-yellow-600',
  pink: 'border-pink-600',
};

const colorHex = {
  green: '#4ade80',
  red: '#f87171',
  blue: '#60a5fa',
  orange: '#fb923c',
  purple: '#a78bfa',
  yellow: '#fbbf24',
  pink: '#f472b6',
};

export default function KnowledgeChecklistModule({
  checklistItems = [],
  essayParts = [],
  feedbacks = [],
  feedbackMappings = [],
  onFuseBlocks,
  essayText = '',
  onHoverFeedback,
  onHoverPart,
  onEditChecklistItem,
  onDeleteChecklistItem,
  onAddChecklistItem,
  hoveredPartId = null,
  onScrollToPart = null, // 新增：滚动到文章部分的回调
  onRefill = null, // 新增：重新填充回调
}) {
  const [draggedBlock, setDraggedBlock] = useState(null);
  const [fusedBlocks, setFusedBlocks] = useState([]);
  const [pendingFuseResult, setPendingFuseResult] = useState(null); // 待确认的融合结果
  const [fusing, setFusing] = useState(false); // 是否正在融合中
  const [hoveredBlockId, setHoveredBlockId] = useState(null);
  const [hoveredChecklistItemId, setHoveredChecklistItemId] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const fusionCanvasRef = useRef(null);

  // 为每个反馈分配颜色（阶段二独立管理）
  const feedbackColorMap = new Map();
  feedbacks.forEach((feedback, index) => {
    feedbackColorMap.set(feedback.id, phase2Colors[index % phase2Colors.length]);
  });

  // 为每个文章部分分配颜色（用于纵向方块）
  const partColorMap = new Map();
  essayParts.forEach((part, index) => {
    partColorMap.set(part.id, phase2Colors[index % phase2Colors.length]);
  });

  // 构建网格数据：每个方格对应一个 (checklistItem, essayPart) 组合
  const gridData = [];
  checklistItems.forEach((checklistItem) => {
    essayParts.forEach((part) => {
      // 找到映射到这个组合的反馈
      const mappedFeedbacks = feedbackMappings.filter(
        (mapping) =>
          mapping.checklist_items.includes(checklistItem.id) &&
          mapping.essay_part_ids.includes(part.id)
      );

      // 只取第一个映射的feedback，确保每个格子只有一个内容
      const firstMapping = mappedFeedbacks[0];
      const firstFeedback = firstMapping ? feedbacks.find((f) => f.id === firstMapping.feedback_id) : null;
      
      gridData.push({
        checklistItemId: checklistItem.id,
        partId: part.id,
        feedbacks: firstFeedback ? [{ ...firstFeedback, color: partColorMap.get(part.id) }] : [],
      });
    });
  });

  const handleDragStart = (e, feedbackId) => {
    setDraggedBlock(feedbackId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (!draggedBlock) return;

    const feedback = feedbacks.find((f) => f.id === draggedBlock);
    if (!feedback) return;

    // 检查是否已经有另一个块在融合画布中
    if (fusedBlocks.length === 0) {
      setFusedBlocks([feedback]);
    } else if (fusedBlocks.length === 1 && fusedBlocks[0].id !== feedback.id) {
      // 融合两个块
      const feedback1 = fusedBlocks[0];
      const feedback2 = feedback;
      
      // 找到这两个反馈对应的文章部分（用于确定颜色）
      const mapping1 = feedbackMappings.find((m) => m.feedback_id === feedback1.id);
      const mapping2 = feedbackMappings.find((m) => m.feedback_id === feedback2.id);
      const partId1 = mapping1?.essay_part_ids?.[0];
      const partId2 = mapping2?.essay_part_ids?.[0];
      
      // 先显示临时融合块
      const tempFusedBlock = {
        id: `fused-${feedback1.id}-${feedback2.id}`,
        feedback1,
        feedback2,
        color1: partId1 ? partColorMap.get(partId1) : 'gray',
        color2: partId2 ? partColorMap.get(partId2) : 'gray',
      };
      setFusedBlocks([tempFusedBlock]);
      
      // 调用融合API，但不直接添加
      if (onFuseBlocks) {
        setFusing(true);
        try {
          // 调用融合API（不传入existingResult，让它生成新的）
          const result = await onFuseBlocks(feedback1, feedback2, essayParts, essayText);
          // 保存融合结果，等待用户确认
          setPendingFuseResult(result);
        } catch (error) {
          console.error('Fusion failed', error);
          alert('Fusion failed. Please try again later.');
          setFusedBlocks([]);
        } finally {
          setFusing(false);
        }
      }
    }

    setDraggedBlock(null);
  };

  const handleDragEnd = () => {
    setDraggedBlock(null);
  };

  const clearFusionCanvas = () => {
    setFusedBlocks([]);
    setPendingFuseResult(null);
  };

  const handleConfirmFuse = async () => {
    if (pendingFuseResult && pendingFuseResult.new_checklist_item && onFuseBlocks) {
      const feedback1 = fusedBlocks[0]?.feedback1;
      const feedback2 = fusedBlocks[0]?.feedback2;
      if (feedback1 && feedback2) {
        try {
          // 传递融合结果给父组件，让它添加新的知识清单项
          await onFuseBlocks(feedback1, feedback2, essayParts, essayText, pendingFuseResult);
          setPendingFuseResult(null);
          setFusedBlocks([]);
        } catch (error) {
          console.error('Confirm fusion failed', error);
          alert('Failed to add new checklist item. Please try again later.');
        }
      }
    }
  };

  const handleCancelFuse = () => {
    setPendingFuseResult(null);
    setFusedBlocks([]);
  };

  const getHoveredFeedback = () => {
    if (hoveredBlockId) {
      return feedbacks.find((f) => f.id === hoveredBlockId);
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* 知识清单网格 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <div className="w-full">
          {/* 表头：知识清单项 */}
          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: `50px repeat(${checklistItems.length}, 1fr)` }}>
            <div></div>
            {checklistItems.map((item) => {
              const isHovered = hoveredChecklistItemId === item.id;
              const isEditing = editingItemId === item.id;
              
              return (
                <div
                  key={item.id}
                  className="text-xs font-semibold text-slate-700 text-center p-2 bg-slate-50 rounded border border-slate-200 relative group"
                  onMouseEnter={(e) => {
                    setHoveredChecklistItemId(item.id);
                    // 计算元素的位置，用于固定悬浮框在top-center位置
                    const rect = e.currentTarget.getBoundingClientRect();
                    const tooltipWidth = 320; // w-80 = 320px
                    const left = rect.left + rect.width / 2 - tooltipWidth / 2;
                    const top = rect.top;
                    
                    // 确保tooltip不超出视窗
                    const adjustedLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
                    const adjustedTop = Math.max(10, top - 10) + 10; // 在元素上方10px
                    
                    setTooltipPosition({ x: adjustedLeft, y: adjustedTop });
                  }}
                  onMouseLeave={() => {
                    // 如果不在编辑状态，才关闭悬浮框
                    if (editingItemId !== item.id) {
                      setHoveredChecklistItemId(null);
                    }
                  }}
                >
                  <div>{item.name}</div>
                  {/* 悬浮显示详情 - 固定在top-center位置 */}
                  {isHovered && (
                    <div className="fixed z-9998 w-80 max-w-[90vw] p-3 bg-slate-900 text-white text-xs rounded shadow-xl"
                      style={{
                        left: `${tooltipPosition.x}px`,
                        top: `${tooltipPosition.y}px`,
                        transform: 'translateY(-100%)', // 始终显示在元素上方
                      }}
                    >
                      <div className="font-semibold mb-2">{item.name}</div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                // Ctrl+Enter 或 Cmd+Enter 保存
                                if (onEditChecklistItem) {
                                  onEditChecklistItem(item.id, editValue);
                                }
                                setEditingItemId(null);
                                setEditValue('');
                                setHoveredChecklistItemId(null);
                              } else if (e.key === 'Escape') {
                                setEditingItemId(null);
                                setEditValue('');
                                setHoveredChecklistItemId(null);
                              }
                            }}
                            className="w-full text-xs px-2 py-1.5 border border-slate-600 rounded bg-slate-800 text-white resize-none"
                            rows={4}
                            autoFocus
                            placeholder="Enter knowledge checklist description..."
                          />
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onEditChecklistItem) {
                                  onEditChecklistItem(item.id, editValue);
                                }
                                setEditingItemId(null);
                                setEditValue('');
                                setHoveredChecklistItemId(null);
                              }}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItemId(null);
                                setEditValue('');
                                setHoveredChecklistItemId(null);
                              }}
                              className="px-2 py-1 bg-slate-600 hover:bg-slate-700 rounded text-xs cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mb-2 whitespace-pre-wrap wrap-break-word">{item.description || 'No description'}</div>
                          <div className="flex gap-2 pt-2 border-t border-slate-700">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItemId(item.id);
                                setEditValue(item.description || '');
                                // 保持悬浮框打开
                              }}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Are you sure you want to delete ${item.name}?`)) {
                                  if (onDeleteChecklistItem) {
                                    onDeleteChecklistItem(item.id);
                                  }
                                }
                                setHoveredChecklistItemId(null);
                              }}
                              className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 表格内容 */}
          {essayParts.map((part) => (
            <div
              key={part.id}
              className="grid gap-2 mb-2"
              style={{ gridTemplateColumns: `50px repeat(${checklistItems.length}, 1fr)` }}
              onMouseEnter={() => onHoverPart?.(part.id)}
              onMouseLeave={() => onHoverPart?.(null)}
            >
              {/* 行标签：文章部分 - 填充颜色 */}
              <div
                className={`flex items-center justify-center text-xs text-slate-600 font-medium p-2 rounded border-2 transition-all ${
                  hoveredPartId === part.id
                    ? 'border-yellow-400 shadow-md'
                    : 'border-slate-200'
                }`}
                style={{
                  backgroundColor: hoveredPartId === part.id
                    ? `${colorHex[partColorMap.get(part.id)] || '#9ca3af'}40`
                    : colorHex[partColorMap.get(part.id)] || '#f1f5f9',
                }}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: colorHex[partColorMap.get(part.id)] || '#94a3b8',
                  }}
                ></div>
              </div>

              {/* 方格内容 */}
              {checklistItems.map((checklistItem) => {
                const cellData = gridData.find(
                  (d) => d.checklistItemId === checklistItem.id && d.partId === part.id
                );
                const cellFeedbacks = cellData?.feedbacks || [];

                return (
                  <div
                    key={`${part.id}-${checklistItem.id}`}
                    className="aspect-square border border-slate-200 rounded bg-white relative overflow-hidden"
                  >
                    {cellFeedbacks.length > 0 ? (
                      (() => {
                        const feedback = cellFeedbacks[0]; // 每个格子只有一个feedback
                        const blockId = `block-${feedback.id}`;
                        const isHovered = hoveredBlockId === blockId;
                        // 使用文章部分的颜色（partId对应的颜色）
                        const color = partColorMap.get(part.id) || 'gray';

                        return (
                          <div
                            key={blockId}
                            draggable
                            onDragStart={(e) => handleDragStart(e, feedback.id)}
                            onDragEnd={handleDragEnd}
                            onMouseEnter={(e) => {
                              setHoveredBlockId(blockId);
                              onHoverFeedback?.(feedback.id);
                              
                              // 计算tooltip位置（色块的top-center位置）
                              const blockElement = e.currentTarget;
                              const rect = blockElement.getBoundingClientRect();
                              const tooltipWidth = 320; // w-80 = 320px
                              const left = rect.left + rect.width / 2 - tooltipWidth / 2;
                              const top = rect.top;
                              
                              // 确保tooltip不超出视窗
                              const adjustedLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
                              const adjustedTop = Math.max(10, top - 10); // 在色块上方10px
                              
                              setTooltipPosition({ x: adjustedLeft, y: adjustedTop });
                              
                              // 悬浮时触发滚动到对应的文章部分
                              if (onScrollToPart) {
                                onScrollToPart(part.id);
                              }
                            }}
                            onMouseLeave={() => {
                              setHoveredBlockId(null);
                              onHoverFeedback?.(null);
                            }}
                            className={`${colorClasses[color] || 'bg-gray-400'} ${colorBorders[color] || 'border-gray-600'} border rounded cursor-move hover:opacity-80 transition-opacity relative group w-full h-full`}
                            style={{
                              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                            }}
                            title={feedback.text}
                          >
                            {/* 悬停提示 - 只显示当前悬浮的块，固定在色块top-center位置 */}
                            {isHovered && (
                              <div className="fixed z-99999 w-80 max-w-[90vw] p-3 bg-slate-900 text-white text-xs rounded shadow-xl pointer-events-none"
                                style={{
                                  left: `${tooltipPosition.x}px`,
                                  top: `${tooltipPosition.y}px`,
                                  transform: 'translateY(-100%)', // 始终显示在色块上方
                                }}
                              >
                                <div className="font-semibold mb-2">F{feedback.id}</div>
                                <div className="whitespace-pre-wrap wrap-break-wordbreak-words max-h-[60vh] overflow-y-auto">{feedback.text}</div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">-</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Drag colored blocks into the fusion canvas:</span>
        <div className="flex gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="text-slate-400">=</span>
          ))}
        </div>
        <span className="text-slate-400">→</span>
      </div>

      <div
        ref={fusionCanvasRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="min-h-[120px] p-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 relative"
      >
        {(() => {
          const nextItemNumber = checklistItems.length + 1;
          const nextItemName = `C${nextItemNumber}`;
          return (
            <div className="text-xs font-semibold text-slate-600 mb-2">Fusion canvas ({nextItemName})</div>
          );
        })()}
        
        {fusedBlocks.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-8">
            Drag two colored blocks here to fuse them.
          </div>
        ) : (
          <div className="space-y-2">
              {fusedBlocks.map((block) => {
                if (block.feedback1 && block.feedback2) {
                  // 融合块
                  const color1Hex = colorHex[block.color1] || '#9ca3af';
                  const color2Hex = colorHex[block.color2] || '#9ca3af';
                  
                  // 找到两个反馈对应的文章部分
                  const mapping1 = feedbackMappings.find((m) => m.feedback_id === block.feedback1.id);
                  const mapping2 = feedbackMappings.find((m) => m.feedback_id === block.feedback2.id);
                  const partIds1 = mapping1?.essay_part_ids || [];
                  const partIds2 = mapping2?.essay_part_ids || [];
                  // 合并所有相关的部分ID（去重）
                  const allPartIds = [...new Set([...partIds1, ...partIds2])];
                  
                  return (
                    <div key={block.id} className="space-y-2">
                      <div
                        className="relative p-3 bg-white border-2 border-slate-300 rounded-lg cursor-pointer"
                        style={{
                          background: `repeating-linear-gradient(45deg, ${color1Hex}, ${color1Hex} 10px, ${color2Hex} 10px, ${color2Hex} 20px)`,
                        }}
                        onMouseEnter={() => {
                          // 高亮两个反馈
                          onHoverFeedback?.(block.feedback1.id);
                          setTimeout(() => onHoverFeedback?.(block.feedback2.id), 100);
                          
                          // 高亮并滚动到对应的文章部分
                          if (allPartIds.length > 0 && onHoverPart && onScrollToPart) {
                            // 高亮第一个部分
                            const firstPartId = allPartIds[0];
                            onHoverPart(firstPartId);
                            // 滚动到第一个部分
                            onScrollToPart(firstPartId);
                          }
                        }}
                        onMouseLeave={() => {
                          onHoverFeedback?.(null);
                          if (onHoverPart) {
                            onHoverPart(null);
                          }
                        }}
                      >
                        <div className="bg-white/90 p-2 rounded">
                          <div className="text-xs font-semibold text-slate-700 mb-1">
                            {block.feedback1.text}
                          </div>
                          <div className="text-xs text-slate-600">
                            {block.feedback2.text}
                          </div>
                        </div>
                      </div>
                      {/* 显示融合结果和确认按钮 */}
                      {pendingFuseResult && pendingFuseResult.new_checklist_item && (() => {
                        const nextItemNumber = checklistItems.length + 1;
                        const correctItemName = `C${nextItemNumber}`;
                        return (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="text-xs font-semibold text-blue-900 mb-1">
                              New checklist item: {correctItemName}
                            </div>
                            <div className="text-xs text-blue-700 mb-2">
                              {pendingFuseResult.new_checklist_item.description}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={handleConfirmFuse}
                                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                              >
                                Confirm and add as {correctItemName}
                              </button>
                              <button
                                onClick={handleCancelFuse}
                                className="px-3 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                      {fusing && (
                        <div className="text-xs text-slate-500 text-center py-2">
                          Fusing...
                        </div>
                      )}
                    </div>
                  );
                } else {
                  const mapping = feedbackMappings.find((m) => m.feedback_id === block.id);
                  const partId = mapping?.essay_part_ids?.[0];
                  const color = partId ? partColorMap.get(partId) : 'gray';
                  return (
                    <div
                      key={block.id}
                      className={`${colorClasses[color] || 'bg-gray-400'} ${colorBorders[color] || 'border-gray-600'} border-2 w-16 h-16 rounded inline-block`}
                      style={{
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                      }}
                      title={block.text}
                    />
                  );
                }
              })}
            <button
              onClick={clearFusionCanvas}
              className="mt-2 px-3 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

