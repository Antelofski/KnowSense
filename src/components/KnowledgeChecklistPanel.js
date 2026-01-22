'use client';

import { memo, useState } from 'react';

const KnowledgeChecklistPanel = memo(function KnowledgeChecklistPanel({
  sortedChecklistItems,
  selectedChecklistItemId,
  editingChecklistItemId,
  editChecklistValue,
  isAddingChecklistItem,
  newChecklistValue,
  sortOrder,
  onAddChecklistItem,
  onConfirmAddChecklistItem,
  onCancelAddChecklistItem,
  onEditChecklistItem,
  onDeleteChecklistItem,
  onSelectChecklistItem,
  onSetEditingChecklistItemId,
  onSetEditChecklistValue,
  onSetNewChecklistValue,
  onSetSortOrder,
  matrixScrollRef,
  // 旧逻辑：从评论矩阵直接拖拽反馈文本生成一个 checklist item
  onDropFeedbackAsChecklistItem,
  // 新逻辑：从文章矩阵 / 评论矩阵拖拽色块到「New Checklist Item」作为 evidence
  onDropEvidenceBlock,
  evidenceBlocks = [],
  onRemoveEvidenceBlock,
  onGenerateChecklistCandidates,
  candidateItems = [],
  isGeneratingCandidates = false,
  selectedCandidateId,
  onSelectCandidate,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);

    const json = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');

    // 优先尝试解析为来自矩阵色块的结构化数据
    if (json && onDropEvidenceBlock && isAddingChecklistItem) {
      try {
        const payload = JSON.parse(json);
        if (payload && payload.kind === 'matrix-block') {
          onDropEvidenceBlock(payload);
          return;
        }
      } catch {
        // 不是 JSON，则继续走旧的文本逻辑
      }
    }

    if (!onDropFeedbackAsChecklistItem) return;

    const text = (json || '').trim();
    if (!text) return;

    onDropFeedbackAsChecklistItem(text);
  };

  const handleDragOver = (event) => {
    // 允许放置
    event.preventDefault();
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  return (
    <div
      className={`flex-[4] bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden transition-shadow ${
        isDragOver ? 'ring-2 ring-indigo-400 ring-offset-2' : ''
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="shrink-0 p-6 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          Knowledge Checklist
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddChecklistItem}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            title="Add checklist item"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => onSetSortOrder(sortOrder === 'asc' ? 'count-desc' : 'asc')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              sortOrder === 'count-desc'
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            title={
              sortOrder === 'asc' 
                ? 'Current: Default order (C1→Cn), click to switch to count descending' 
                : 'Current: Count descending, click to switch to default order'
            }
          >
            Sort
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {/* 添加新知识清单项的输入框 */}
          {isAddingChecklistItem && (
            <div className="p-4 rounded-lg border-2 border-indigo-300 bg-indigo-50 shadow-md space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="font-semibold text-slate-900">
                  New Checklist Item
                </div>
              </div>
              {/* evidence 区域：展示从矩阵拖拽进来的色块 */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Evidence blocks (drag from Essay / Feedback matrix)
                </div>
                <div
                  className="min-h-[60px] rounded-lg border border-dashed border-indigo-300 bg-white/60 px-2 py-2 flex flex-wrap gap-2 items-start"
                >
                  {evidenceBlocks.length === 0 ? (
                    <div className="text-xs text-slate-400">
                      Drag colored blocks here as evidence for new checklist item.
                    </div>
                  ) : (
                    evidenceBlocks.map((block) => (
                      <button
                        key={block.id}
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          block.type === 'essay'
                            ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        }`}
                        title={block.preview || ''}
                        onClick={() => {
                          // 点击 evidence 本身 = 在矩阵中高亮对应位置
                          block.onFocus?.();
                        }}
                      >
                        <span>{block.label}</span>
                        {onRemoveEvidenceBlock && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveEvidenceBlock(block.id);
                            }}
                            className="ml-1 cursor-pointer text-[10px] text-slate-400 hover:text-red-500"
                          >
                            ✕
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <textarea
                  value={newChecklistValue}
                  onChange={(e) => onSetNewChecklistValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      onConfirmAddChecklistItem();
                    } else if (e.key === 'Escape') {
                      onCancelAddChecklistItem();
                    }
                  }}
                  className="w-full text-sm px-2 py-1.5 border border-slate-300 rounded bg-white resize-none"
                  rows={3}
                  autoFocus
                  placeholder="Enter checklist item description... (or generate from evidence below)"
                />
                {/* LLM 候选项 */}
                {candidateItems.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-800">
                        LLM-suggested potential knowledge points (choose one)
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {candidateItems.map((item) => {
                        const isSelected = selectedCandidateId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelectCandidate?.(item.id)}
                            className={`w-full text-left rounded-md border px-2 py-1.5 text-xs transition-colors ${
                              isSelected
                                ? 'border-indigo-500 bg-white shadow-sm'
                                : 'border-slate-200 bg-white/80 hover:border-indigo-300 hover:bg-white'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div
                                className={`mt-0.5 h-3 w-3 rounded-full border flex items-center justify-center ${
                                  isSelected
                                    ? 'border-indigo-600 bg-indigo-600'
                                    : 'border-slate-300 bg-white'
                                }`}
                              >
                                {isSelected && (
                                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="text-[11px] font-semibold text-slate-900">
                                  {item.title || item.name || item.label || 'Candidate'}
                                </div>
                                <div className="text-[11px] text-slate-700 whitespace-pre-wrap">
                                  {item.description}
                                </div>
                                {item.sources && item.sources.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pt-0.5">
                                    {item.sources.map((src) => (
                                      <span
                                        key={src.id}
                                        className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                                      >
                                        {src.label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onConfirmAddChecklistItem}
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                  >
                    Confirm Add
                  </button>
                  <button
                    type="button"
                    onClick={onCancelAddChecklistItem}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={evidenceBlocks.length === 0 || isGeneratingCandidates}
                    onClick={onGenerateChecklistCandidates}
                    className={`ml-auto px-3 py-1.5 text-xs font-medium rounded transition-colors border ${
                      evidenceBlocks.length === 0 || isGeneratingCandidates
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {isGeneratingCandidates ? 'Generating…' : 'LLM Suggested Item Candidates'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {sortedChecklistItems.map((item) => {
            const count = item.count || 0;
            const isEditing = editingChecklistItemId === item.id;
            const isSelected = selectedChecklistItemId === item.id;
            
            return (
              <div
                key={item.id}
                onClick={() => {
                  onSelectChecklistItem(isSelected ? null : item.id);
                  if (matrixScrollRef.current) {
                    matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className={`p-4 rounded-lg border transition-colors relative group cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50 shadow-md'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="font-semibold text-slate-900">
                      {item.name}
                    </div>
                    <div className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-full shrink-0">
                      {count}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChecklistItem(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-opacity"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editChecklistValue}
                      onChange={(e) => onSetEditChecklistValue(e.target.value)}
                      className="w-full text-sm px-2 py-1.5 border border-slate-300 rounded bg-white resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onEditChecklistItem(item.id, editChecklistValue);
                          onSetEditingChecklistItemId(null);
                          onSetEditChecklistValue('');
                        }}
                        className="px-2 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSetEditingChecklistItemId(null);
                          onSetEditChecklistValue('');
                        }}
                        className="px-2 py-1 text-xs font-medium bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div 
                    className="text-sm text-slate-600 cursor-pointer"
                    onDoubleClick={() => {
                      onSetEditingChecklistItemId(item.id);
                      onSetEditChecklistValue(item.description);
                    }}
                    title="Double-click to edit"
                  >
                    {item.description || '(Empty)'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default KnowledgeChecklistPanel;

