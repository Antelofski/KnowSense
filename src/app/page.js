'use client';

import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { combinedPhase1AndPhase2Batch, filterEssaysByCriteria, filterFeedbacksByCriteria, generateEssayPartsTemplate, generateChecklistCandidatesFromEvidence } from '@/lib/generateFromOpenAI';
import KnowledgeChecklistPanel from '@/components/KnowledgeChecklistPanel';
import MatrixHeader from '@/components/MatrixHeader';
import FeedbackMatrixRow from '@/components/FeedbackMatrixRow';
import EssayMatrixRow from '@/components/EssayMatrixRow';

// 可配置的显示文章数量
const MAX_DISPLAY_ESSAYS = 20;

// 首次导入时预分析的文章数量（可配置）
const INITIAL_BATCH_ANALYZE_COUNT = 5;

export default function Home() {
  const fileInputRef = useRef(null);
  const matrixScrollRef = useRef(null); // 矩阵滚动容器ref
  const feedbackFilterInputRef = useRef(null); // 评论矩阵筛选输入框 ref
  const [isLoading, setIsLoading] = useState(false);

  // 存储导入的数据
  const [knowledgeList, setKnowledgeList] = useLocalStorageState('knowledgeList', {
    defaultValue: [],
  });
  const [studentWorks, setStudentWorks] = useLocalStorageState('studentWorks', {
    defaultValue: [],
  });
  const [phase2Data, setPhase2Data] = useLocalStorageState('phase2Data', {
    defaultValue: {}, // { workIndex: { feedbackMappings: [] } }
  });
  // 保存 modelWorks（仅需要 essay 文本，用于 LLM 参考）
  const [modelWorks, setModelWorks] = useLocalStorageState('modelWorks', {
    defaultValue: [], // [{ essay: string }]
  });

  // 存储所有feedback列表（按文章顺序，从第一篇文章的feedback依次排开）
  const [allFeedbacks, setAllFeedbacks] = useLocalStorageState('allFeedbacks', {
    defaultValue: [], // [{ workIndex, feedbackId, ... }]
  });

  // 全局标准分段结构模板（所有文章共享：只保存id/name/description，不保存具体段落ID）
  const [globalEssayPartsTemplate, setGlobalEssayPartsTemplate] = useLocalStorageState('globalEssayPartsTemplate', {
    defaultValue: [], // [{ id, name, description }]
  });

  // analyzedWorks 需要转换为数组存储（Set不能直接序列化）
  const [analyzedWorksArray, setAnalyzedWorksArray] = useLocalStorageState('analyzedWorks', {
    defaultValue: [],
  });

  // 将数组转换为Set使用（用于内部逻辑）
  const analyzedWorks = useMemo(() => new Set(analyzedWorksArray), [analyzedWorksArray]);
  const setAnalyzedWorks = (updater) => {
    if (typeof updater === 'function') {
      setAnalyzedWorksArray((prev) => {
        const prevSet = new Set(prev);
        const newSet = updater(prevSet);
        return Array.from(newSet);
      });
    } else {
      setAnalyzedWorksArray(Array.from(updater));
    }
  };

  // 按文章索引的loading状态（Set<workIndex>）
  const [analyzingWorks, setAnalyzingWorks] = useState(new Set());

  // 页面刷新后的续跑标记（只执行一次）
  const resumePendingRef = useRef(false);

  // 排序状态：'asc' | 'count-desc'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' 默认顺序 (C1-Cn), 'count-desc' 按数量降序

  // 原本用于 LLM 搜索的筛选状态（当前已停用部分高级功能）
  // const [filterText, setFilterText] = useState('');
  // const [isFiltering, setIsFiltering] = useState(false);
  // const [filteredWorkIndices, setFilteredWorkIndices] = useState(null);
  // const [filterError, setFilterError] = useState(null);
  // 评论矩阵 LLM 筛选相关状态（自定义条件筛选）
  const [isFilteringFeedbacks, setIsFilteringFeedbacks] = useState(false); // 是否正在筛选feedbacks
  const [filteredFeedbackKeys, setFilteredFeedbackKeys] = useState(null); // LLM 返回的命中集合：Set<`${workIndex}-${feedbackId}`>
  const [feedbackFilterError, setFeedbackFilterError] = useState(null); // 筛选错误信息

  // 切换按钮状态（false=文章矩阵, true=评论矩阵）
  const [toggleState, setToggleState] = useState(false);

  // 展开状态：记录哪些文章被展开了
  const [expandedWorks, setExpandedWorks] = useState(new Set());

  // 文章矩阵的选中状态（点击色块）
  const [essayClickedBlockKey, setEssayClickedBlockKey] = useState(null);
  const [essayClickedPartIds, setEssayClickedPartIds] = useState(new Set());
  const [essayActivePartKey, setEssayActivePartKey] = useState(null);
  const [essayActiveSegmentIds, setEssayActiveSegmentIds] = useState(new Set());

  // 评论矩阵的选中状态（点击色块）
  const [feedbackClickedBlockKey, setFeedbackClickedBlockKey] = useState(null);
  const [feedbackClickedPartIds, setFeedbackClickedPartIds] = useState(new Set());
  const [feedbackActivePartKey, setFeedbackActivePartKey] = useState(null);
  const [feedbackActiveSegmentIds, setFeedbackActiveSegmentIds] = useState(new Set());

  // 编辑状态：记录哪些知识清单项正在编辑
  const [editingChecklistItemId, setEditingChecklistItemId] = useState(null);
  const [editChecklistValue, setEditChecklistValue] = useState('');

  // 添加状态：是否正在添加新的知识清单项
  const [isAddingChecklistItem, setIsAddingChecklistItem] = useState(false);
  const [newChecklistValue, setNewChecklistValue] = useState('');

  // 选中的知识清单项ID（用于排序和样式）
  const [selectedChecklistItemId, setSelectedChecklistItemId] = useState(null);

  // 筛选：选中的知识清单项ID集合（用于筛选文章/评论）
  const [filteredChecklistItemIds, setFilteredChecklistItemIds] = useState(new Set());

  // 筛选弹窗显示状态
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // 展开后网格中悬浮的色块状态（用于显示tooltip）
  const [hoveredBlockKey, setHoveredBlockKey] = useState(null); // 格式: `${workIndex}-${partId}-${checklistItemId}`
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [hoveredPartId, setHoveredPartId] = useState(null); // 当前悬浮的文章部分ID
  const [hoveredSegmentIds, setHoveredSegmentIds] = useState(new Set()); // 当前悬浮的段落ID集合

  // 评论矩阵中悬浮的评论标识状态（用于显示tooltip）
  const [hoveredFeedbackLabel, setHoveredFeedbackLabel] = useState(null); // 格式: `${workIndex}-${feedbackId}`
  const [feedbackTooltipPosition, setFeedbackTooltipPosition] = useState({ x: 0, y: 0 });

  // 新建 checklist item 时：从矩阵拖拽进来的 evidence blocks + LLM 候选项
  const [draftEvidenceBlocks, setDraftEvidenceBlocks] = useState([]); // [{ id,type,workIndex,checklistId,feedbackId?,paragraphIds?,label,text,onFocus,preview }]
  const [draftCandidates, setDraftCandidates] = useState([]); // [{id,description,sources:[{id,label}]}]
  const [isGeneratingCandidates, setIsGeneratingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);

  // 文章部分refs（用于滚动）
  const partRefs = useRef({}); // { `${workIndex}-${partId}`: element }

  // 切换展开状态
  const toggleExpand = useCallback((workIndex) => {
    // 检查是否有分段数据，如果没有则禁止展开
    const workPhase2Data = phase2Data[workIndex];
    const hasEssayParts = workPhase2Data?.essayParts && workPhase2Data.essayParts.length > 0;

    if (!hasEssayParts) {
      // 如果没有分段数据，不允许展开
      return;
    }

    setExpandedWorks((prev) => {
      const next = new Set(prev);
      if (next.has(workIndex)) {
        next.delete(workIndex);
      } else {
        next.add(workIndex);
      }
      return next;
    });
  }, [phase2Data]);

  // 添加知识清单项
  const handleAddChecklistItem = useCallback(() => {
    setIsAddingChecklistItem(true);
    setNewChecklistValue('');
    // 开始新的「新建」会话时，清空 evidence 与候选项
    setDraftEvidenceBlocks([]);
    setDraftCandidates([]);
    setSelectedCandidateId(null);
  }, []);

  // 确认添加知识清单项
  const handleConfirmAddChecklistItem = useCallback(() => {
    if (newChecklistValue.trim()) {
      setKnowledgeList((prev) => [...prev, newChecklistValue.trim()]);
    }
    setIsAddingChecklistItem(false);
    setNewChecklistValue('');
    setDraftEvidenceBlocks([]);
    setDraftCandidates([]);
    setSelectedCandidateId(null);
  }, [newChecklistValue, setKnowledgeList]);

  // 取消添加知识清单项
  const handleCancelAddChecklistItem = useCallback(() => {
    setIsAddingChecklistItem(false);
    setNewChecklistValue('');
    setDraftEvidenceBlocks([]);
    setDraftCandidates([]);
    setSelectedCandidateId(null);
  }, []);

  // 删除知识清单项
  const handleDeleteChecklistItem = (itemId) => {
    const index = itemId - 1; // itemId 是从1开始的，需要转换为数组索引
    if (index < 0 || index >= knowledgeList.length) return;

    // 确认删除
    const confirmed = confirm(`Are you sure you want to delete ${checklistItems.find((item) => item.id === itemId)?.name || `C${itemId}`}? All data related to this checklist item in all essays will be deleted.`);
    if (!confirmed) return;

    // 从知识清单中删除
    setKnowledgeList((prev) => {
      const newList = prev.filter((_, i) => i !== index);
      return newList;
    });

    // 更新所有文章的 phase2Data，完全移除对该知识清单项的所有引用
    setPhase2Data((prev) => {
      const updated = {};
      Object.keys(prev).forEach((workIndex) => {
        const workData = prev[workIndex];

        // 过滤掉所有包含被删除知识清单项的 feedbackMappings
        const filteredMappings = (workData.feedbackMappings || [])
          .map((mapping) => {
            // 移除被删除的知识清单项ID，并重新编号（删除项之后的ID都减1）
            const updatedChecklistItems = mapping.checklist_items
              .filter((id) => id !== itemId) // 先过滤掉被删除的项
              .map((id) => id > itemId ? id - 1 : id); // 重新编号：删除项之后的ID都减1

            // 如果移除后 checklist_items 为空，返回 null（会被过滤掉）
            if (updatedChecklistItems.length === 0) {
              return null;
            }

            return {
              ...mapping,
              checklist_items: updatedChecklistItems,
            };
          })
          .filter((mapping) => mapping !== null); // 移除所有 null（即被完全删除的映射）

        updated[workIndex] = {
          ...workData,
          feedbackMappings: filteredMappings,
        };
      });
      return updated;
    });
  };

  // 编辑知识清单项
  const handleEditChecklistItem = useCallback((itemId, newDescription) => {
    const index = itemId - 1;
    if (index < 0 || index >= knowledgeList.length) return;

    setKnowledgeList((prev) => {
      const newList = [...prev];
      newList[index] = newDescription;
      return newList;
    });
  }, [knowledgeList.length, setKnowledgeList]);

  // 解析文章文本的辅助函数
  // 需求：英文文本中，一个“完整句子”应该成为一个最小分段：
  // - 以 . ! ? 结束
  // - 下一个句子的开头一般是大写字母（或引号后的大写）
  const parseEssayText = (text) => {
    if (!text) return { segments: [] };
    const colorOrder = ['green', 'red', 'blue', 'orange'];

    // 先将所有换行合并成空格，避免因为换行导致句子被错误截断
    const normalized = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return { segments: [] };

    // 基于标点 + 大写字母来切句子：
    // 1. 以 . ! ? 结尾认为是句子结束
    // 2. 后面跟着若干空格 + 大写字母 / 引号+大写，认为是新句子开始
    const rawSentences = normalized.split(/(?<=[.!?])\s+(?=[A-Z"“])/);

    const sentences = rawSentences
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const segments = sentences.map((s, index) => ({
      id: index + 1,
      text: s,
      color: colorOrder[index % colorOrder.length],
    }));

    return { segments };
  };

  // 将知识清单转换为标准格式（固定顺序，用于右侧矩阵）
  const checklistItems = useMemo(() => {
    if (!knowledgeList || knowledgeList.length === 0) return [];
    return knowledgeList.map((item, index) => ({
      id: index + 1,
      name: `C${index + 1}`,
      description: item || '',
    }));
  }, [knowledgeList]);

  // 计算每个知识清单项被满足的数量（直接从数据源计算，避免循环依赖）
  const getChecklistItemCount = useMemo(() => {
    const countMap = new Map();

    if (!studentWorks || studentWorks.length === 0 || checklistItems.length === 0) {
      return countMap;
    }

    // 统计所有文章中满足的数量
    studentWorks.forEach((work, workIndex) => {
      const workPhase2Data = phase2Data[workIndex];
      const feedbackMappings = workPhase2Data?.feedbackMappings || [];

      // 收集这篇文章所有反馈满足的知识清单项ID
      const satisfiedChecklistIds = new Set();
      feedbackMappings.forEach((mapping) => {
        if (mapping.checklist_items && Array.isArray(mapping.checklist_items)) {
          mapping.checklist_items.forEach((id) => satisfiedChecklistIds.add(id));
        }
      });

      // 统计满足的知识清单项
      satisfiedChecklistIds.forEach((id) => {
        countMap.set(id, (countMap.get(id) || 0) + 1);
      });
    });

    return countMap;
  }, [studentWorks, phase2Data, checklistItems]);

  // 将知识清单转换为可排序格式（用于左侧知识清单显示）
  const sortedChecklistItems = useMemo(() => {
    if (!knowledgeList || knowledgeList.length === 0) return [];
    const items = knowledgeList.map((item, index) => ({
      id: index + 1,
      name: `C${index + 1}`,
      description: item || '',
      count: getChecklistItemCount.get(index + 1) || 0,
    }));

    // 根据排序状态排序
    if (sortOrder === 'count-desc') {
      // 按数量降序：数量多的在前
      return items.sort((a, b) => {
        if (a.count !== b.count) {
          return b.count - a.count;
        }
        // 数量相同，按ID升序
        return a.id - b.id;
      });
    }
    // 'asc' 默认顺序，保持 C1-Cn 原顺序
    return items;
  }, [knowledgeList, sortOrder, getChecklistItemCount]);

  // 解析feedback文本的辅助函数（带低信息 & 负面标记）
  const parseFeedbackText = (text) => {
    if (!text) return [];
    const colorOrder = ['green', 'red', 'blue', 'orange'];

    // 找到第一个以 "CONCEPTS" 或 "Concepts" 开头的行，从那里开始解析
    const lines = text.split('\n');
    let startIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (/^CONCEPTS\s*&/i.test(trimmedLine) || /^Concepts\s*&/i.test(trimmedLine)) {
        startIndex = i;
        break;
      }
    }

    // 从找到的行开始，重新组合文本
    const relevantText = lines.slice(startIndex).join('\n');

    // 根据空行拆成块，每一块代表一条评语
    const blocks = relevantText
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);

    // 过滤掉 OVERALL SCORE 这一类总结项，不当作评语卡片
    // 只保留包含 "(x pts)" 格式的评语（如 "(10 pts)", "(5 pts)" 等）
    // 如果整个文本中至少有一个块包含 "(x pts)"，则只保留包含 "(x pts)" 的块
    // 如果整个文本中没有任何块包含 "(x pts)"，则保留所有块（除了 OVERALL SCORE）
    const hasAnyPointsFormat = blocks.some((block) => /\(\d+\s*pts?\)/i.test(block));
    const effectiveBlocks = blocks.filter((block) => {
      const firstLine = block.split('\n')[0]?.trim() || '';
      if (/^OVERALL SCORE\b/i.test(firstLine)) return false;
      if (hasAnyPointsFormat) {
        const hasPointsFormat = /\(\d+\s*pts?\)/i.test(block);
        if (!hasPointsFormat) return false;
      }
      return true;
    });

    return effectiveBlocks
      .map((block, index) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

        // 识别第一行是否是大写标题（包含冒号、全大写、或者包含 "(x pts)" 格式）
        const firstLine = lines[0] || '';
        const isTitleLine =
          firstLine.includes(':') ||
          (/^[A-Z\s&]+$/.test(firstLine) && firstLine.length < 100) ||
          /\(\d+\s*pts?\)/i.test(firstLine);

        // 如果第一行是标题，跳过它，只使用后面的内容
        let contentLines = lines;
        let title = '';
        if (isTitleLine && lines.length > 1) {
          title = firstLine;
          contentLines = lines.slice(1);
        } else if (isTitleLine && lines.length === 1) {
          // 只有标题行，没有内容，跳过这个block
          return null;
        } else {
          // 第一行不是标题，全部作为内容
          contentLines = lines;
          title = '';
        }

        const bodyText = contentLines.join('\n');
        const hasBody = contentLines.length > 0 && bodyText.trim().length > 0;
        let mainText = bodyText.trim();

        // 清理多余的*号和-号（markdown列表标记）
        mainText = mainText
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            const cleaned = trimmed.replace(/^[-*]\s*/, '');
            return cleaned;
          })
          .filter((line) => line.length > 0)
          .join('\n')
          .trim();

        if (!mainText) {
          return null;
        }

        // 额外检查：如果内容看起来还是标题格式，也不应该被当作 feedback
        const stillLooksLikeTitle =
          (mainText.includes(':') && mainText.length < 150) ||
          (/^[A-Z\s&]+$/.test(mainText) && mainText.length < 100) ||
          /\(\d+\s*pts?\)/i.test(mainText);

        if (stillLooksLikeTitle) {
          return null;
        }

        // 信息量判定：检查是否包含泛泛的词语或缺乏具体内容
        const genericPhrases = [
          /\b(good\s+job|nice\s+job|well\s+done|excellent\s+work|great\s+work)\b/i,
          /\b(good|nice|well|great|excellent|fine|okay|ok)\s*[.!]?\s*$/i,
          /^(good|nice|well|great|excellent|fine|okay|ok)\s*[.!]?\s*$/i,
        ];
        const isGeneric = genericPhrases.some((pattern) => pattern.test(mainText));
        const isShort = mainText.length < 40;
        const isLowInfo = !hasBody || isShort || isGeneric;

        // 负面评语判定：检查是否包含负面关键词
        const negativePhrases = [
          /\b(not|bad|poor|lacks|missing|fails|didn't|doesn't|inadequate|insufficient)\b/i,
          /\b(no\s+clear|no\s+evidence|no\s+examples|no\s+support)\b/i,
          /\b(weak|weakness|problem|issue|error|mistake|incorrect|wrong)\b/i,
          /\b(needs\s+improvement|could\s+be\s+better|should\s+be|must\s+be)\b/i,
          // 转折词语，通常用来引出批评或问题
          /\b(but|however|although|though|even\s+though|despite|nevertheless|yet|whereas)\b/i,
        ];
        const isNegative = negativePhrases.some((pattern) => pattern.test(mainText));

        // 正面评语判定：检查是否包含正面关键词
        const positivePhrases = [
          /\b(good|great|excellent|outstanding|well|nice|strong|clear|effective|solid)\b/i,
          /\b(demonstrates|shows|illustrates|exemplifies|highlights)\b/i,
          /\b(good\s+use\s+of|well-developed|well-written|well-structured|well-organized)\b/i,
          /\b(impressive|thorough|comprehensive|detailed|insightful|thoughtful)\b/i,
          /\b(successful|successfully|achieved|accomplished|strongly|clearly)\b/i,
          /\b(appropriate|relevant|accurate|precise|convincing|persuasive)\b/i,
          /\b(enhances|strengthens|improves|supports|reinforces|validates)\b/i,
        ];
        const isPositive = positivePhrases.some((pattern) => pattern.test(mainText));

        return {
          id: index + 1,
          title: title || '',
          text: mainText,
          color: colorOrder[index % colorOrder.length],
          hasBody,
          isLowInfo,
          isNegative,
          isPositive,
        };
      })
      .filter(Boolean);
  };

  // 为每个知识清单项分配颜色
  const getChecklistItemColor = useCallback((itemId) => {
    const colors = [
      { bg: '#3b82f6', border: '#2563eb' }, // blue
      { bg: '#10b981', border: '#059669' }, // green
      { bg: '#f59e0b', border: '#d97706' }, // amber
      { bg: '#ef4444', border: '#dc2626' }, // red
      { bg: '#8b5cf6', border: '#7c3aed' }, // purple
      { bg: '#ec4899', border: '#db2777' }, // pink
      { bg: '#06b6d4', border: '#0891b2' }, // cyan
      { bg: '#84cc16', border: '#65a30d' }, // lime
      { bg: '#f97316', border: '#ea580c' }, // orange
      { bg: '#6366f1', border: '#4f46e5' }, // indigo
    ];
    return colors[(itemId - 1) % colors.length];
  }, []);

  // 计算每篇文章满足哪些知识清单项（显示所有文章）
  const essayChecklistMatrix = useMemo(() => {
    if (!studentWorks || studentWorks.length === 0 || checklistItems.length === 0) {
      return [];
    }

    // 显示所有文章（后续可以根据 filterText 做筛选）
    const worksToDisplay = studentWorks;

    let matrix = worksToDisplay.map((work, workIndex) => {
      const workPhase2Data = phase2Data[workIndex];
      const essayChecklistMappings = workPhase2Data?.essayChecklistMappings || [];

      // 直接使用最新结构：LLM 输出的 essay_checklist_mappings
      const checklistStatus = checklistItems.map((item) => {
        const m = essayChecklistMappings.find(
          (em) => em.checklist_id === item.id
        );
        const paragraphIds = m?.paragraph_ids || [];
        return {
          id: item.id,
          satisfied: paragraphIds.length > 0,
          paragraphIds,
        };
      });

      // 收集本篇文章中被满足的 checklist IDs，供排序/筛选使用
      const satisfiedChecklistIds = new Set(
        checklistStatus.filter((s) => s.satisfied).map((s) => s.id)
      );

      return {
        workIndex,
        work,
        checklistStatus,
        satisfiedCount: satisfiedChecklistIds.size, // 满足的知识清单项数量
        selectedSatisfied: selectedChecklistItemId ? satisfiedChecklistIds.has(selectedChecklistItemId) : null, // 选中的知识清单项是否满足
        satisfiedChecklistIds, // 保存满足的知识清单项ID集合，用于筛选
      };
    });

    // 如果有筛选条件，只显示满足所有勾选条件的文章
    if (filteredChecklistItemIds.size > 0) {
      matrix = matrix.filter((item) => {
        // 检查是否满足所有勾选的知识清单项
        return Array.from(filteredChecklistItemIds).every((id) =>
          item.satisfiedChecklistIds.has(id)
        );
      });
    }

    // 如果有选中的知识清单项，进行排序
    if (selectedChecklistItemId) {
      matrix = matrix.sort((a, b) => {
        // 首先按选中的知识清单项是否满足排序：满足的在前，不满足的在后
        if (a.selectedSatisfied !== b.selectedSatisfied) {
          return a.selectedSatisfied ? -1 : 1;
        }
        // 然后按文章顺序排序（workIndex）
        return a.workIndex - b.workIndex;
      });
    } else {
      // 没有选中时，按文章顺序排序（workIndex）
      matrix = matrix.sort((a, b) => a.workIndex - b.workIndex);
    }

    return matrix;
  }, [studentWorks, checklistItems, phase2Data, selectedChecklistItemId, filteredChecklistItemIds]);

  // 基于 feedback 映射计算“按文章聚合”的评论矩阵（用于 Feedback Matrix 行 + 展开网格）
  // 逻辑：一篇文章的一行，Ck 是否填色完全由该篇所有 feedback_mappings 是否提到 Ck 决定，
  // 且 paragraphIds 为所有相关 feedback 的 related_paragraph_ids 的并集。
  // 额外：为每个 (workIndex, checklistId) 记录一个代表性的 feedbackId，
  // 这样在 Feedback Matrix 模式下拖拽色块时，可以标记是由哪条反馈触发的填色。
  const feedbackEssayMatrix = useMemo(() => {
    if (!studentWorks || studentWorks.length === 0 || checklistItems.length === 0) {
      return [];
    }

    return studentWorks.map((work, workIndex) => {
      const workPhase2Data = phase2Data[workIndex];
      const feedbackMappings = workPhase2Data?.feedbackMappings || [];

      const checklistStatus = checklistItems.map((item) => {
        const paragraphIdSet = new Set();
        let representativeFeedbackId = null;
        feedbackMappings.forEach((m) => {
          if (Array.isArray(m.checklist_items) && m.checklist_items.includes(item.id)) {
            if (representativeFeedbackId == null && typeof m.feedback_id === 'number') {
              representativeFeedbackId = m.feedback_id;
            }
            (m.related_paragraph_ids || []).forEach((pid) => paragraphIdSet.add(pid));
          }
        });
        // 获取代表性 feedback 的正面/负面信息
        let isPositive = false;
        let isNegative = false;
        if (representativeFeedbackId != null) {
          const feedback = allFeedbacks.find(
            (f) => f.workIndex === workIndex && f.feedbackId === representativeFeedbackId
          );
          if (feedback) {
            isPositive = !!feedback.isPositive;
            isNegative = !!feedback.isNegative;
          }
        }
        return {
          id: item.id,
          satisfied: paragraphIdSet.size > 0,
          paragraphIds: Array.from(paragraphIdSet),
          // 用于 Feedback Matrix 下的拖拽：代表性 feedbackId
          feedbackId: representativeFeedbackId,
          isPositive,
          isNegative,
        };
      });

      return {
        workIndex,
        work,
        checklistStatus,
      };
    });
  }, [studentWorks, checklistItems, phase2Data, allFeedbacks]);

  // 计算评论矩阵：从第一篇文章的feedback依次排开
  const feedbackChecklistMatrix = useMemo(() => {
    if (!allFeedbacks || allFeedbacks.length === 0 || checklistItems.length === 0) {
      return [];
    }

    let matrix = allFeedbacks.map(({ workIndex, feedbackId, text, title, isNegative, isPositive }) => {
      const workPhase2Data = phase2Data[workIndex];
      const feedbackMappings = workPhase2Data?.feedbackMappings || [];

      const mapping = feedbackMappings.find((m) => m.feedback_id === feedbackId);
      const satisfiedChecklistIds = new Set();
      const checklistParagraphMap = new Map(); // cid => Set<paragraphId>

      if (mapping && Array.isArray(mapping.checklist_items)) {
        const relatedParagraphIds = Array.isArray(mapping.related_paragraph_ids)
          ? mapping.related_paragraph_ids
          : [];
        mapping.checklist_items.forEach((cid) => {
          satisfiedChecklistIds.add(cid);
          if (!checklistParagraphMap.has(cid)) {
            checklistParagraphMap.set(cid, new Set());
          }
          const set = checklistParagraphMap.get(cid);
          relatedParagraphIds.forEach((pid) => set.add(pid));
        });
      }

      const checklistStatus = checklistItems.map((item) => {
        const paragraphIdSet = checklistParagraphMap.get(item.id) || new Set();
        return {
          id: item.id,
          satisfied: satisfiedChecklistIds.has(item.id),
          paragraphIds: Array.from(paragraphIdSet),
        };
      });

      // 检查选中的知识清单项是否满足
      const selectedSatisfied = selectedChecklistItemId
        ? satisfiedChecklistIds.has(selectedChecklistItemId)
        : null;

      return {
        workIndex,
        feedbackId,
        feedbackText: text || '',
        feedbackTitle: title || '',
        checklistStatus,
        isNegative: !!isNegative,
        isPositive: !!isPositive,
        selectedSatisfied, // 选中的知识清单项是否满足
        satisfiedChecklistIds, // 保存满足的知识清单项ID集合，用于筛选
      };
    });

    // 如果有文本筛选条件（LLM筛选），只显示匹配的评论
    if (filteredFeedbackKeys && filteredFeedbackKeys.size > 0) {
      matrix = matrix.filter((item) => {
        const key = `${item.workIndex}-${item.feedbackId}`;
        return filteredFeedbackKeys.has(key);
      });
    }

    // 如果有 checklist 勾选条件，只显示满足所有勾选条件的评论
    if (filteredChecklistItemIds.size > 0) {
      matrix = matrix.filter((item) => {
        // 检查是否满足所有勾选的知识清单项
        return Array.from(filteredChecklistItemIds).every((id) =>
          item.satisfiedChecklistIds.has(id)
        );
      });
    }

    // 如果有选中的知识清单项，进行排序
    if (selectedChecklistItemId) {
      matrix = matrix.sort((a, b) => {
        // 首先按选中的知识清单项是否满足排序：满足的在前，不满足的在后
        if (a.selectedSatisfied !== b.selectedSatisfied) {
          return a.selectedSatisfied ? -1 : 1;
        }
        // 然后按文章顺序排序（workIndex）
        if (a.workIndex !== b.workIndex) {
          return a.workIndex - b.workIndex;
        }
        // 最后按评论顺序排序（feedbackId）
        return a.feedbackId - b.feedbackId;
      });
    } else {
      // 没有选中时，按文章顺序和评论顺序排序
      matrix = matrix.sort((a, b) => {
        if (a.workIndex !== b.workIndex) {
          return a.workIndex - b.workIndex;
        }
        return a.feedbackId - b.feedbackId;
      });
    }

    return matrix;
  }, [allFeedbacks, checklistItems, phase2Data, selectedChecklistItemId, filteredChecklistItemIds, filteredFeedbackKeys]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      event.target.value = '';
      return;
    }

    setIsLoading(true);

    // 在开始处理文件之前，立即清空所有状态（参考 page.backup.js）
    setKnowledgeList([]);
    setStudentWorks([]);
    setPhase2Data({});
    setAllFeedbacks([]);
    setGlobalEssayPartsTemplate([]);
    setToggleState(false);
    setSortOrder('asc');
    setExpandedWorks(new Set());
    setAnalyzedWorksArray([]);
    setAnalyzingWorks(new Set());
    setFilteredChecklistItemIds(new Set());
    setFilteredFeedbackKeys(null);
    setFeedbackFilterError(null);
    setIsFilteringFeedbacks(false);
    if (feedbackFilterInputRef.current) {
      feedbackFilterInputRef.current.value = '';
    }
      // 每次导入前清空 localStorage，后续根据导入内容决定是否开启续跑
    resumePendingRef.current = false;
    window.localStorage.clear();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result;
        const data = JSON.parse(content);

        // =======================
        // 1. 识别是否为本应用导出的“带分析结果”的会话文件
        // =======================
        const isKnowSenseExport =
          data._knowSenseExport === true ||
          (!!data.phase2Data && !!data.globalEssayPartsTemplate);

        // -----------------------
        // 导入导出文件：直接恢复状态，然后交给续跑逻辑补齐未完成分析
        // -----------------------
        if (isKnowSenseExport) {
          // 知识清单
          const knowledgeListData = Array.isArray(data.knowledgeList)
            ? data.knowledgeList
            : [];
          setKnowledgeList(knowledgeListData);

          // 作品
          const worksData = Array.isArray(data.studentWorks)
            ? data.studentWorks
            : [];
          setStudentWorks(worksData);

          // 全局分段模板
          if (Array.isArray(data.globalEssayPartsTemplate)) {
            setGlobalEssayPartsTemplate(data.globalEssayPartsTemplate);
          } else {
            setGlobalEssayPartsTemplate([]);
          }

          // 阶段二分析结果：直接恢复
          if (data.phase2Data && typeof data.phase2Data === 'object') {
            setPhase2Data(data.phase2Data);
          } else {
            setPhase2Data({});
          }

          // 已分析篇目集合
          if (Array.isArray(data.analyzedWorks)) {
            setAnalyzedWorksArray(data.analyzedWorks);
          } else if (data.phase2Data && typeof data.phase2Data === 'object') {
            // 如果没有显式存 analyzedWorks，就根据 phase2Data 的 key 推断
            const keys = Object.keys(data.phase2Data).map((k) => Number(k));
            setAnalyzedWorksArray(keys.filter((k) => !Number.isNaN(k)));
          } else {
            setAnalyzedWorksArray([]);
          }

          // 评论列表：如果导出文件里有，直接用；否则根据文章重新解析
          if (Array.isArray(data.allFeedbacks)) {
            setAllFeedbacks(data.allFeedbacks);
          } else {
            const feedbacksList = [];
            worksData.forEach((work, workIndex) => {
              const feedbackText = work.feedbacks || '';
              const parsedFeedbacks = parseFeedbackText(feedbackText);
              parsedFeedbacks.forEach((feedback) => {
                feedbacksList.push({
                  workIndex,
                  feedbackId: feedback.id,
                  title: feedback.title || '',
                  text: feedback.text || '',
                  isLowInfo: !!feedback.isLowInfo,
                  isNegative: !!feedback.isNegative,
                  isPositive: !!feedback.isPositive,
                });
              });
            });
            setAllFeedbacks(feedbacksList);
          }

          // 对于导出的会话文件，不在导入阶段主动调用 AI，
          // 而是交给 useEffect 中的续跑逻辑自动补齐未完成篇目
          resumePendingRef.current = false;

          console.log('Imported KnowSense export:', data);
        } else {
          // -----------------------
          // 原始输入 JSON：保持现有导入 + 首批分析逻辑
          // -----------------------

          // 保存知识清单
          let knowledgeListData = [];
          if (data.knowledgeList && Array.isArray(data.knowledgeList)) {
            knowledgeListData = data.knowledgeList;
            setKnowledgeList(knowledgeListData);
          } else {
            setKnowledgeList([]);
          }

          // 准备知识清单项（用于AI分析）
          const checklistItemsForInit = knowledgeListData.map((item, index) => ({
            id: index + 1,
            name: `C${index + 1}`,
            description: item || '',
          }));

          // 保存学生作品
          if (data.studentWorks && Array.isArray(data.studentWorks)) {
            setStudentWorks(data.studentWorks);

            // 保存 modelWorks（如果有），用于后续生成统一分段模板
            const modelWorksData = data.modelWorks && Array.isArray(data.modelWorks)
              ? data.modelWorks
              : [];
            setModelWorks(modelWorksData.map((mw) => ({
              essay: mw.essay || '',
            })));

            // 解析并存储所有feedback列表（从第一篇文章的feedback依次排开）
            const feedbacksList = [];
            data.studentWorks.forEach((work, workIndex) => {
              const feedbackText = work.feedbacks || '';
              const parsedFeedbacks = parseFeedbackText(feedbackText);
              parsedFeedbacks.forEach((feedback) => {
                feedbacksList.push({
                  workIndex,
                  feedbackId: feedback.id,
                  title: feedback.title || '',
                  text: feedback.text || '',
                  isLowInfo: !!feedback.isLowInfo,
                  isNegative: !!feedback.isNegative,
                  isPositive: !!feedback.isPositive,
                });
              });
            });
            setAllFeedbacks(feedbacksList);

            // 如果没有 phase2Data，需要调用AI分析
            if (data.studentWorks.length > 0 && checklistItemsForInit.length > 0) {
              // 计算需要预分析的篇数（可控）
              const maxToAnalyze = Math.min(
                INITIAL_BATCH_ANALYZE_COUNT,
                data.studentWorks.length
              );

              // 1. 如果还没有全局分段模板，优先用 modelWorks 来生成统一模板
              let templateForAi = globalEssayPartsTemplate.length > 0 ? globalEssayPartsTemplate : null;
              const modelEssaysForAi = modelWorksData.map((model) => ({
                essay: model.essay || '',
              }));

              if (!templateForAi && modelWorksData.length > 0) {
                try {
                  if (modelEssaysForAi.length > 0) {
                    // 仅将所有范文传给 LLM 生成统一的分段依据（不需要预先切段）
                    console.log('[AI 调用准备] generateEssayPartsTemplate 参数（生成全局模板）:', {
                      modelEssaysForAi,
                    });
                    const templateResult = await generateEssayPartsTemplate(modelEssaysForAi);
                    const templateSegments = templateResult.template_segments || templateResult.segments || [];
                    // 如果 LLM 没有返回任何有效分段，则认为模板生成失败，让用户重新导入数据
                    if (!templateSegments || templateSegments.length === 0) {
                      console.error('Generate globalEssayPartsTemplate failed: empty template_segments from LLM');
                      alert('Failed to generate a unified segmentation template from model works. Please adjust your modelWorks (范文) and re-import the JSON. All data has been cleared.');
                      setIsLoading(false);
                      event.target.value = '';
                      return;
                    }
                    // 保存结构信息：id/name/description（description 可选）
                    const templateToSave = templateSegments.map((part) => ({
                      id: part.id,
                      name: part.name,
                      description: part.description || '',
                    }));
                    setGlobalEssayPartsTemplate(templateToSave);
                    templateForAi = templateToSave;
                  } else {
                    console.error('Generate globalEssayPartsTemplate failed: no modelWorks essays provided');
                    alert('Failed to generate a unified segmentation template: modelWorks is empty. Please provide modelWorks in your JSON and re-import.');
                    setIsLoading(false);
                    event.target.value = '';
                    return;
                  }
                } catch (e) {
                  console.error('Generate globalEssayPartsTemplate from modelWorks failed', e);
                  // 模板生成失败时，提示用户并终止本次导入（数据已在读取文件前清空）
                  alert('Failed to generate a unified segmentation template from model works. Please check your modelWorks content and re-import the JSON.');
                  setIsLoading(false);
                  event.target.value = '';
                  handleClearData(true)
                  return;
                }
              }

              // 批量分析函数（可复用）
              const processBatch = async (worksBatch, startIdx, templateForAi, checklistItemsForInit, currentGlobalTemplate, markAsAnalyzing = false) => {
                const batchWorksForAi = [];
                const batchParsedEssays = new Map();
                const batchParsedFeedbacks = new Map();

                // 标记本批次为 analyzing（如果指定）
                if (markAsAnalyzing) {
                  setAnalyzingWorks((prev) => {
                    const next = new Set(prev);
                    worksBatch.forEach((_, offset) => {
                      next.add(startIdx + offset);
                    });
                    return next;
                  });
                }

                try {
                  for (let i = 0; i < worksBatch.length; i++) {
                    const workIdx = startIdx + i;
                    const work = worksBatch[i];
                    if (!work) continue;

                    const wEssayText = work.essay || '';
                    const wFeedbackText = work.feedbacks || '';
                    const wParsedEssay = parseEssayText(wEssayText);
                    const wParsedFeedbacks = parseFeedbackText(wFeedbackText);

                    batchParsedEssays.set(workIdx, wParsedEssay);
                    batchParsedFeedbacks.set(workIdx, wParsedFeedbacks);

                    batchWorksForAi.push({
                      work_id: workIdx,
                      paragraphs: wParsedEssay.segments.map((s) => ({
                        id: s.id,
                        text: s.text,
                      })),
                      feedback_items: wParsedFeedbacks.map((f) => ({
                        id: f.id,
                        title: f.title || '',
                        text: f.text || '',
                      })),
                    });
                  }

                  if (batchWorksForAi.length === 0) return;

                  // 在调用 combinedPhase1AndPhase2Batch 之前，输出将要传给 AI 的参数
                  console.log('[AI 调用准备] combinedPhase1AndPhase2Batch 参数（导入阶段批量分析）:', {
                    worksForAi: batchWorksForAi,
                    templateForAi,
                    checklistItemsForInit,
                  });

                  const combinedResult = await combinedPhase1AndPhase2Batch(
                    batchWorksForAi,
                    templateForAi,
                    checklistItemsForInit
                  );

                  const workResults = combinedResult.works || [];
                  let templateUpdated = false;

                  workResults.forEach((workResult) => {
                    const idx = workResult.work_id;
                    const wParsedEssay = batchParsedEssays.get(idx);
                    const wParsedFeedbacks = batchParsedFeedbacks.get(idx);
                    if (!wParsedEssay || !wParsedFeedbacks) return;

                    // 阶段二：文章分段
                    const phase2Segments = workResult.essay_segments || [];
                    let finalParts = phase2Segments;
                    // 如果 LLM 没有返回分段结果，则使用全局模板结构生成“空分段”（paragraph_ids 为空）
                    if (!finalParts || finalParts.length === 0) {
                      const baseTemplate = (templateForAi || currentGlobalTemplate || []).length > 0
                        ? (templateForAi || currentGlobalTemplate)
                        : [];
                      finalParts = baseTemplate.map((part) => ({
                        id: part.id,
                        name: part.name,
                        description: part.description || '',
                        paragraph_ids: [],
                      }));
                    }

                    // 如全局模板尚未建立，且当前有有效分段，则用当前分段结构初始化模板（只在第一次）
                    if (!templateUpdated && currentGlobalTemplate.length === 0 && finalParts.length > 0) {
                      const templateToSave = finalParts.map((part) => ({
                        id: part.id,
                        name: part.name,
                      }));
                      setGlobalEssayPartsTemplate(templateToSave);
                      templateUpdated = true;
                    }

                    // 阶段二：feedback 到知识清单和文章部分的映射
                    // 注意：为了避免高亮“一整坨”原文，只保留 LLM 返回的第一个 related_paragraph_id
                    // 逻辑与旧版 page.backup.js 中二阶段生成保持一致
                    const phase2Mappings = (workResult.feedback_mappings || []).map((m) => {
                      const paragraphIds = m.related_paragraph_ids || [];
                      const firstParagraphId =
                        paragraphIds.length > 0 ? [paragraphIds[0]] : [];
                      return {
                        feedback_id: m.feedback_id,
                        checklist_items: m.checklist_items || [],
                        essay_part_ids: m.essay_part_ids || [],
                        // 仅保存一个精确的段落 ID，供矩阵和 Knowledge Grid 精细高亮使用
                        related_paragraph_ids: firstParagraphId,
                      };
                    });

                    // 文章直接到 checklist 的映射（可能不存在）
                    const essayChecklistMappings =
                      (workResult.essay_checklist_mappings || []).map((m) => ({
                        checklist_id: m.checklist_id,
                        paragraph_ids: Array.isArray(m.paragraph_ids)
                          ? m.paragraph_ids
                          : [],
                      }));

                    // 保存阶段二数据
                    setPhase2Data((prev) => ({
                      ...prev,
                      [idx]: {
                        essayParts: finalParts,
                        feedbackMappings: phase2Mappings,
                        essayChecklistMappings,
                      },
                    }));

                    // 标记为已分析
                    setAnalyzedWorksArray((prev) => {
                      const prevSet = new Set(prev);
                      prevSet.add(idx);
                      return Array.from(prevSet);
                    });
                  });
                } catch (err) {
                  console.error(`Batch analysis error for works ${startIdx}-${startIdx + worksBatch.length - 1}:`, err);
                  // 不弹窗，避免打断用户操作
                } finally {
                  // 清除本批次 analyzing 标记（如果之前标记了）
                  if (markAsAnalyzing) {
                    setAnalyzingWorks((prev) => {
                      const next = new Set(prev);
                      worksBatch.forEach((_, offset) => {
                        next.delete(startIdx + offset);
                      });
                      return next;
                    });
                  }
                }
              };

              // 先处理第一批（前N篇）
              try {
                await processBatch(
                  data.studentWorks.slice(0, maxToAnalyze),
                  0,
                  templateForAi,
                  checklistItemsForInit,
                  templateForAi || [],
                  false // 导入时不需要标记为 analyzing
                );
              } catch (err) {
                console.error('First batch analysis error:', err);
                alert('Error analyzing first batch of essays and feedback. Please try again later.');
              }

              // 异步继续处理剩余文章（分批，每批5篇）
              // 在本地开发环境下，不继续分析剩余文章
              if (process.env.NODE_ENV !== 'development' && data.studentWorks.length > maxToAnalyze) {
                (async () => {
                  // 等待第一批完成后再获取最新的template
                  await new Promise(resolve => setTimeout(resolve, 100));
                  const currentTemplate = globalEssayPartsTemplate.length > 0 ? globalEssayPartsTemplate : null;

                  const batchSize = INITIAL_BATCH_ANALYZE_COUNT;
                  for (let startIdx = maxToAnalyze; startIdx < data.studentWorks.length; startIdx += batchSize) {
                    const endIdx = Math.min(startIdx + batchSize, data.studentWorks.length);
                    const batch = data.studentWorks.slice(startIdx, endIdx);
                    await processBatch(
                      batch,
                      startIdx,
                      currentTemplate,
                      checklistItemsForInit,
                      currentTemplate || [],
                      false // 导入时不需要标记为 analyzing
                    );
                  }
                })();
              }

              // 原始导入文件：首批分析已由导入流程主动触发，不需要续跑逻辑再跑一次
              resumePendingRef.current = true;
            } else {
              // 如果没有知识清单或文章，只设置空数据
              setPhase2Data({});
            }
          } else {
            setStudentWorks([]);
            setAllFeedbacks([]);
            setPhase2Data({});
          }

          console.log('Imported raw data:', data);
        }
      } catch (error) {
        console.error('Failed to parse JSON', error);
        alert('Import failed: Invalid JSON format.');
      } finally {
        setIsLoading(false);
        event.target.value = '';
      }
    };

    reader.readAsText(file, 'utf-8');
  };

  // 导出当前分析结果（包含分段依据），用于下次直接导入并续跑
  const handleExportAnalysis = () => {
    if (!knowledgeList.length || !studentWorks.length) {
      alert('No data to export. Please import and analyze data first.');
      return;
    }

    const exportPayload = {
      _knowSenseExport: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      knowledgeList,
      studentWorks,
      globalEssayPartsTemplate,
      phase2Data,
      allFeedbacks,
      analyzedWorks: analyzedWorksArray,
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');
    a.href = url;
    a.download = `knowsense-analysis-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 页面重新加载时，如果存在未完成的文章分析，则在后台继续批量生成（不影响已完成文章的切换）
  // 在本地开发环境下，不执行续跑逻辑
  useEffect(() => {
    // 在开发环境下，不继续分析未完成的文章
    if (process.env.NODE_ENV === 'development') return;

    if (resumePendingRef.current) return;
    if (!studentWorks || studentWorks.length === 0) return;

    // 找出未完成（Phase1+Phase2都没完整）的文章索引
    // 跳过正在处理中的文章（避免与导入流程重复处理）
    const pendingIndices = studentWorks
      .map((_, idx) => idx)
      .filter((idx) => {
        // 如果正在处理中，跳过
        if (analyzingWorks.has(idx)) return false;

        const isAnalyzed = analyzedWorks.has(idx);
        const phase2 = phase2Data[idx];
        const hasPhase2 =
          phase2 &&
          ((phase2.essayParts && phase2.essayParts.length > 0) ||
            (phase2.feedbackMappings && phase2.feedbackMappings.length > 0));
        return !(isAnalyzed && hasPhase2);
      });

    if (pendingIndices.length === 0) return;

    resumePendingRef.current = true;

    (async () => {
      try {
        const checklistItemsForInit = knowledgeList.map((item, index) => ({
          id: index + 1,
          name: `C${index + 1}`,
          description: item || '',
        }));
        const templateForAi =
          globalEssayPartsTemplate && globalEssayPartsTemplate.length > 0
            ? globalEssayPartsTemplate
            : null;

        const batchSize = INITIAL_BATCH_ANALYZE_COUNT;

        const runBatch = async (batchIndices) => {
          // 构造 batch 的 worksForAi
          const worksForAi = [];
          const batchParsedEssays = new Map();
          const batchParsedFeedbacks = new Map();

          // 标记本批次为 analyzing
          setAnalyzingWorks((prev) => {
            const next = new Set(prev);
            batchIndices.forEach((idx) => next.add(idx));
            return next;
          });

          try {
            batchIndices.forEach((idx) => {
              const work = studentWorks[idx];
              if (!work) return;
              const essayText = work.essay || '';
              const feedbackText = work.feedbacks || '';
              const parsedEssay = parseEssayText(essayText);
              const parsedFeedbacks = parseFeedbackText(feedbackText);

              batchParsedEssays.set(idx, parsedEssay);
              batchParsedFeedbacks.set(idx, parsedFeedbacks);

              worksForAi.push({
                work_id: idx,
                paragraphs: parsedEssay.segments.map((s) => ({
                  id: s.id,
                  text: s.text,
                })),
                feedback_items: parsedFeedbacks.map((f) => ({
                  id: f.id,
                  title: f.title || '',
                  text: f.text || '',
                })),
              });
            });

            if (worksForAi.length === 0) return;

            // 在调用 combinedPhase1AndPhase2Batch 之前，输出将要传给 AI 的参数（续跑分析）
            console.log('[AI 调用准备] combinedPhase1AndPhase2Batch 参数（页面刷新续跑）:', {
              worksForAi,
              templateForAi,
              checklistItemsForInit,
            });

            const combinedResult = await combinedPhase1AndPhase2Batch(
              worksForAi,
              templateForAi,
              checklistItemsForInit
            );

            const workResults = combinedResult.works || [];
            let templateUpdated = false;

            workResults.forEach((workResult) => {
              const idx = workResult.work_id;
              const parsedEssay = batchParsedEssays.get(idx);
              const parsedFeedbacks = batchParsedFeedbacks.get(idx);
              if (!parsedEssay || !parsedFeedbacks) return;

              const phase1Mappings = workResult.feedback_mappings || [];
              const mappingById = new Map();
              phase1Mappings.forEach((m) => {
                const paragraphIds = m.related_paragraph_ids || [];
                const firstParagraphId = paragraphIds.length > 0 ? [paragraphIds[0]] : [];
                mappingById.set(m.feedback_id, firstParagraphId);
              });

              const mappedFeedbacks = parsedFeedbacks.map((f) => ({
                ...f,
                relatedSegments: mappingById.get(f.id) || [],
              }));

              const phase2Segments = workResult.essay_segments || [];
              let finalParts = phase2Segments;
              // 如果 LLM 没有返回分段结果，则使用全局模板结构生成“空分段”（paragraph_ids 为空）
              if (!finalParts || finalParts.length === 0) {
                const baseTemplate =
                  (templateForAi && templateForAi.length > 0)
                    ? templateForAi
                    : (globalEssayPartsTemplate && globalEssayPartsTemplate.length > 0
                      ? globalEssayPartsTemplate
                      : []);
                finalParts = baseTemplate.map((part) => ({
                  id: part.id,
                  name: part.name,
                  description: part.description || '',
                  paragraph_ids: [],
                }));
              }

              if (!templateUpdated && (!globalEssayPartsTemplate || globalEssayPartsTemplate.length === 0) && finalParts.length > 0) {
                const templateToSave = finalParts.map((part) => ({
                  id: part.id,
                  name: part.name,
                }));
                setGlobalEssayPartsTemplate(templateToSave);
                templateUpdated = true;
              }

              const phase2Mappings = phase1Mappings.map((m) => {
                const paragraphIds = m.related_paragraph_ids || [];
                const firstParagraphId =
                  paragraphIds.length > 0 ? [paragraphIds[0]] : [];
                return {
                  feedback_id: m.feedback_id,
                  checklist_items: m.checklist_items || [],
                  essay_part_ids: m.essay_part_ids || [],
                  // 与导入阶段保持一致：只保留一个精确的段落 ID
                  related_paragraph_ids: firstParagraphId,
                };
              });

              const essayChecklistMappings =
                (workResult.essay_checklist_mappings || []).map((m) => ({
                  checklist_id: m.checklist_id,
                  paragraph_ids: Array.isArray(m.paragraph_ids)
                    ? m.paragraph_ids
                    : [],
                }));

              // 保存阶段二数据
              setPhase2Data((prev) => ({
                ...prev,
                [idx]: {
                  essayParts: finalParts,
                  feedbackMappings: phase2Mappings,
                  essayChecklistMappings,
                },
              }));

              // 标记为已分析
              setAnalyzedWorksArray((prev) => {
                const prevSet = new Set(prev);
                prevSet.add(idx);
                return Array.from(prevSet);
              });
            });
          } catch (e) {
            console.error('resume batch analysis error', e);
          } finally {
            // 清除本批次 analyzing 标记
            setAnalyzingWorks((prev) => {
              const next = new Set(prev);
              batchIndices.forEach((idx) => next.delete(idx));
              return next;
            });
          }
        };

        for (let i = 0; i < pendingIndices.length; i += batchSize) {
          const batch = pendingIndices.slice(i, i + batchSize);
          await runBatch(batch);
        }
      } catch (e) {
        console.error('resume pending analysis error', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    studentWorks,
    analyzedWorks,
    phase2Data,
    knowledgeList,
    globalEssayPartsTemplate,
    analyzingWorks,
  ]);

  // 清空所有数据（参考 page.backup.js）
  const handleClearData = (noask) => {
    if (!noask) {
      const hasData =
        knowledgeList.length > 0 ||
        studentWorks.length > 0 ||
        allFeedbacks.length > 0;

      if (!hasData) {
        alert('No data to clear.');
        return;
      }

      const confirmed = confirm('Are you sure you want to clear all data? This action cannot be undone.');
      if (!confirmed) {
        return;
      }
    }

    // 清空所有数据与 UI 状态
    setKnowledgeList([]);
    setStudentWorks([]);
    setPhase2Data({});
    setAllFeedbacks([]);
    setToggleState(false);
    setSortOrder('asc');
    setExpandedWorks(new Set());
    setAnalyzedWorksArray([]);
    setAnalyzingWorks(new Set());
    setFilteredChecklistItemIds(new Set());
    setFilteredFeedbackKeys(null);
    setFeedbackFilterError(null);
    setIsFilteringFeedbacks(false);
    if (feedbackFilterInputRef.current) {
      feedbackFilterInputRef.current.value = '';
    }
    resumePendingRef.current = false;

    // 清空矩阵选中 / 悬浮状态
    setEssayClickedBlockKey(null);
    setEssayClickedPartIds(new Set());
    setEssayActivePartKey(null);
    setEssayActiveSegmentIds(new Set());
    setFeedbackClickedBlockKey(null);
    setFeedbackClickedPartIds(new Set());
    setFeedbackActivePartKey(null);
    setFeedbackActiveSegmentIds(new Set());
    setHoveredBlockKey(null);
    setTooltipPosition({ x: 0, y: 0 });
    setHoveredPartId(null);
    setHoveredSegmentIds(new Set());
    setHoveredFeedbackLabel(null);
    setFeedbackTooltipPosition({ x: 0, y: 0 });

    // 清空左侧知识清单相关 UI 状态
    setEditingChecklistItemId(null);
    setEditChecklistValue('');
    setIsAddingChecklistItem(false);
    setNewChecklistValue('');
    setSelectedChecklistItemId(null);
    setShowFilterDropdown(false);

    // 清空 localStorage
    window.localStorage.clear();

    if (!noask) {
      alert('All data has been cleared.');
    }
  };

  // 基于 LLM 的 Feedback 文本筛选功能：根据自定义条件筛选评论矩阵
  const handleFilterFeedbacks = async () => {
    if (!allFeedbacks || allFeedbacks.length === 0) {
      alert('No feedback data to filter. Please import JSON with feedbacks first.');
      return;
    }
    // 如果没有知识清单，就无法按 C1/C2 之类的条件筛选
    if (!checklistItems || checklistItems.length === 0) {
      alert('Knowledge checklist is empty. Please import data with a knowledgeList so that LLM can use C1–Cn when filtering.');
      return;
    }

    const criteria = (feedbackFilterInputRef.current?.value || '').trim();
    if (!criteria) return;

    setIsFilteringFeedbacks(true);
    setFeedbackFilterError(null);

    try {
      // 为每条评论附加它满足的 checklist_items，供 LLM 参考
      const feedbacksForFilter = allFeedbacks.map((f) => {
        const workPhase2Data = phase2Data[f.workIndex];
        const feedbackMappings = workPhase2Data?.feedbackMappings || [];
        const mapping = feedbackMappings.find((m) => m.feedback_id === f.feedbackId);
        return {
          ...f,
          checklist_items: mapping?.checklist_items || [],
        };
      });

      // 在调用 filterFeedbacksByCriteria 之前，输出将要传给 AI 的参数
      console.log('[AI 调用准备] filterFeedbacksByCriteria 参数（评论矩阵文本筛选）:', {
        criteria,
        feedbacksForFilter,
        checklistItems,
      });

      const result = await filterFeedbacksByCriteria(criteria, feedbacksForFilter, checklistItems);
      const matchedFeedbacks = result.matched_feedbacks || [];

      // 转换为 Set，格式: `${workIndex}-${feedbackId}`
      const matchedKeys = new Set(
        matchedFeedbacks.map(({ work_index, feedback_id }) => `${work_index}-${feedback_id}`)
      );

      setFilteredFeedbackKeys(matchedKeys);

      // 滚动评论矩阵到顶部
      if (matrixScrollRef.current) {
        matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (error) {
      console.error('Filter feedbacks error:', error);
      const msg = error?.message || 'Filter failed, please try again';
      setFeedbackFilterError(msg);
      alert(`Filter failed: ${msg}`);
    } finally {
      setIsFilteringFeedbacks(false);
    }
  };

  // 使用 useCallback 优化回调函数
  const handleSelectChecklistItem = useCallback((id) => {
    setSelectedChecklistItemId(id);
    if (id) {
      setFilteredChecklistItemIds(new Set());
    }
    if (matrixScrollRef.current) {
      matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleFeedbackMouseEnter = useCallback((e, workIndex, feedbackId) => {
    const labelKey = `${workIndex}-${feedbackId}`;
    setHoveredFeedbackLabel(labelKey);

    const labelElement = e.currentTarget;
    const rect = labelElement.getBoundingClientRect();
    const tooltipWidth = 320;
    const left = rect.right + 10;
    const top = rect.top;
    const adjustedLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
    const adjustedTop = Math.max(10, top);
    setFeedbackTooltipPosition({ x: adjustedLeft, y: adjustedTop });
  }, []);

  const handleFeedbackMouseLeave = useCallback(() => {
    setHoveredFeedbackLabel(null);
  }, []);

  const hasData = knowledgeList.length > 0 && studentWorks.length > 0;

  // 从评论矩阵拖拽创建新的知识清单项
  const handleAddChecklistItemFromFeedback = useCallback(
    (feedbackText) => {
      const trimmed = (feedbackText || '').trim();
      if (!trimmed) return;
      setKnowledgeList((prev) => [...prev, trimmed]);
    },
    [setKnowledgeList]
  );

  // 左侧「New Checklist Item」接收从矩阵拖拽过来的 evidence block
  const handleDropEvidenceBlock = useCallback((payload) => {
    if (!payload || payload.kind !== 'matrix-block') return;

    const { source, workIndex, checklistId, feedbackId, paragraphIds = [], label: payloadLabel } = payload;
    if (typeof workIndex !== 'number' || typeof checklistId !== 'number') return;

    const work = studentWorks[workIndex];
    if (!work) return;

    const essayText = work.essay || '';
    const parsedEssay = parseEssayText(essayText);

    let text = '';
    if (source === 'essay') {
      const sentences = parsedEssay.segments.filter((seg) =>
        paragraphIds.includes(seg.id)
      );
      text = sentences.map((s) => s.text).join('\n');
    } else if (source === 'feedback') {
      const key = `${workIndex}-${feedbackId}`;
      const feedbackEntry = allFeedbacks.find(
        (f) => f.workIndex === workIndex && f.feedbackId === feedbackId
      );
      text = feedbackEntry?.text || '';
    }

    const label =
      payloadLabel ||
      (source === 'essay'
        ? `Essay-#${workIndex + 1}-C${checklistId}`
        : `Feedback-#${workIndex + 1}-C${checklistId}`);

    const id = `${source}-${workIndex}-${checklistId}-${feedbackId || 'na'}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // onFocus：根据 evidence 类型，在右侧矩阵里自动定位并高亮
    const onFocus = () => {
      // 如果 evidence 来源与当前矩阵类型不一致，则切换
      const shouldBeFeedback = source === 'feedback';
      setToggleState(shouldBeFeedback);

      // 展开对应文章
      const workPhase2Data = phase2Data[workIndex];
      const hasEssayParts = workPhase2Data?.essayParts && workPhase2Data.essayParts.length > 0;
      if (hasEssayParts) {
        setExpandedWorks((prev) => {
          const next = new Set(prev);
          next.add(workIndex);
          return next;
        });
      }

      // 根据 checklistId 定位外层色块被点击的状态
      const blockKey = `${workIndex}-${checklistId}`;
      if (shouldBeFeedback) {
        setFeedbackClickedBlockKey(blockKey);
        // 清空文章矩阵的选中状态，避免冲突
        setEssayClickedBlockKey(null);
        setEssayClickedPartIds(new Set());
        setEssayActivePartKey(null);
        setEssayActiveSegmentIds(new Set());
      } else {
        setEssayClickedBlockKey(blockKey);
        // 清空评论矩阵的选中状态，避免冲突
        setFeedbackClickedBlockKey(null);
        setFeedbackClickedPartIds(new Set());
        setFeedbackActivePartKey(null);
        setFeedbackActiveSegmentIds(new Set());
      }

      // 设置展开内容的高亮状态（与点击色块时的逻辑一致）
      if (paragraphIds && paragraphIds.length > 0 && workPhase2Data?.essayParts) {
        // 找出包含这些段落的第一个 part
        let targetPartId = null;
        for (const part of workPhase2Data.essayParts) {
          if (
            Array.isArray(part.paragraph_ids) &&
            part.paragraph_ids.some((pid) => paragraphIds.includes(pid))
          ) {
            targetPartId = part.id;
            break;
          }
        }

        if (targetPartId != null) {
          const partKey = `${workIndex}-${targetPartId}`;
          if (shouldBeFeedback) {
            setFeedbackClickedPartIds(new Set([targetPartId]));
            setFeedbackActivePartKey(partKey);
            setFeedbackActiveSegmentIds(new Set(paragraphIds));
          } else {
            setEssayClickedPartIds(new Set([targetPartId]));
            setEssayActivePartKey(partKey);
            setEssayActiveSegmentIds(new Set(paragraphIds));
          }
        }
      }

      // 尝试滚动到矩阵顶部，方便用户看到对应行
      if (matrixScrollRef.current) {
        matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    const preview = text.slice(0, 120);

    setDraftEvidenceBlocks((prev) => {
      // 简单去重：同一来源+位置不重复加入（忽略 id）
      const exists = prev.some(
        (b) =>
          b.source === source &&
          b.workIndex === workIndex &&
          b.checklistId === checklistId &&
          (b.feedbackId || null) === (feedbackId || null)
      );
      if (exists) return prev;
      return [
        ...prev,
        {
          id,
          type: source,
          source,
          workIndex,
          checklistId,
          feedbackId,
          paragraphIds,
          label,
          text,
          preview,
          onFocus,
        },
      ];
    });
  }, [allFeedbacks, parseEssayText, phase2Data, studentWorks]);

  const handleRemoveEvidenceBlock = useCallback((id) => {
    setDraftEvidenceBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleGenerateChecklistCandidates = useCallback(async () => {
    if (!draftEvidenceBlocks.length) return;

    setIsGeneratingCandidates(true);
    setDraftCandidates([]);
    setSelectedCandidateId(null);

    try {
      const modelEssaysForAi = (modelWorks || []).map((m) => ({
        essay: m.essay || '',
      }));

      const existingChecklist = knowledgeList.map((item, index) => ({
        id: index + 1,
        name: `C${index + 1}`,
        description: item || '',
      }));

      const { candidates = [] } = await generateChecklistCandidatesFromEvidence(
        draftEvidenceBlocks,
        modelEssaysForAi,
        existingChecklist
      );

      const normalized = candidates.slice(0, 3).map((c, idx) => ({
        id: c.id || `cand-${idx + 1}`,
        description: c.description || '',
        sources: (c.source_evidence_ids || []).map((eId) => {
          const ev = draftEvidenceBlocks.find((b) => b.id === eId);
          return ev
            ? { id: ev.id, label: ev.label }
            : { id: eId, label: eId };
        }),
      }));

      setDraftCandidates(normalized);

      // 默认选中第一个候选项并把描述填入输入框（单选逻辑）
      if (normalized.length > 0) {
        setSelectedCandidateId(normalized[0].id);
        setNewChecklistValue(normalized[0].description || '');
      }
    } catch (e) {
      console.error('generate checklist candidates error', e);
      alert('LLM 生成候选知识点失败，请稍后重试。');
    } finally {
      setIsGeneratingCandidates(false);
    }
  }, [draftEvidenceBlocks, generateChecklistCandidatesFromEvidence, knowledgeList, modelWorks]);

  const handleSelectCandidate = useCallback((candidateId) => {
    setSelectedCandidateId(candidateId);
    const cand = draftCandidates.find((c) => c.id === candidateId);
    if (cand) {
      setNewChecklistValue(cand.description || '');
    }
  }, [draftCandidates]);

  return (
    <div className="h-screen bg-linear-to-br from-slate-100 via-white to-slate-100 flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full flex flex-col flex-1 overflow-hidden px-8 py-8">
        {/* 标题部分 */}
        <div className="shrink-0 mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              KnowSense
            </h1>
            <p className="mt-2 text-sm md:text-base text-slate-500">
              Left side shows the knowledge checklist, right side shows which checklist items each essay satisfies
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFileChange}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={handleImportClick}
              disabled={isLoading}
              className={`inline-flex items-center rounded-full border border-indigo-200 bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 hover:border-indigo-300 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isLoading ? 'Importing...' : 'Import JSON'}
            </button>
            {hasData && (
              <button
                type="button"
                onClick={handleExportAnalysis}
                disabled={isLoading}
                className={`inline-flex items-center rounded-full border border-emerald-200 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 hover:border-emerald-300 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Export Analysis
              </button>
            )}
            {hasData && (
              <button
                type="button"
                onClick={() => handleClearData(false)}
                disabled={isLoading}
                className={`inline-flex items-center rounded-full border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500 hover:border-red-300 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Clear Data
              </button>
            )}
          </div>
        </div>

        {/* 主要内容区域 */}
        {!hasData ? (
          <div className="flex-1 overflow-hidden flex items-center justify-center">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-10 py-12 text-center shadow-sm max-w-xl">
              <p className="text-lg font-medium text-slate-700 mb-2">
                {isLoading
                  ? 'Importing data...'
                  : 'Please import a JSON file to get started'}
              </p>
              {!isLoading && (
                <p className="text-sm text-slate-500">
                  After importing, the knowledge checklist and essay satisfaction matrix will be displayed.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex gap-6 min-h-0">
            {/* 左侧：知识清单列表 - 占40% */}
            <KnowledgeChecklistPanel
              sortedChecklistItems={sortedChecklistItems}
              selectedChecklistItemId={selectedChecklistItemId}
              editingChecklistItemId={editingChecklistItemId}
              editChecklistValue={editChecklistValue}
              isAddingChecklistItem={isAddingChecklistItem}
              newChecklistValue={newChecklistValue}
              sortOrder={sortOrder}
              onAddChecklistItem={handleAddChecklistItem}
              onConfirmAddChecklistItem={handleConfirmAddChecklistItem}
              onCancelAddChecklistItem={handleCancelAddChecklistItem}
              onEditChecklistItem={handleEditChecklistItem}
              onDeleteChecklistItem={handleDeleteChecklistItem}
              onSelectChecklistItem={handleSelectChecklistItem}
              onSetEditingChecklistItemId={setEditingChecklistItemId}
              onSetEditChecklistValue={setEditChecklistValue}
              onSetNewChecklistValue={setNewChecklistValue}
              onSetSortOrder={setSortOrder}
              matrixScrollRef={matrixScrollRef}
              onDropFeedbackAsChecklistItem={handleAddChecklistItemFromFeedback}
              onDropEvidenceBlock={handleDropEvidenceBlock}
              evidenceBlocks={draftEvidenceBlocks}
              onRemoveEvidenceBlock={handleRemoveEvidenceBlock}
              onGenerateChecklistCandidates={handleGenerateChecklistCandidates}
              candidateItems={draftCandidates}
              isGeneratingCandidates={isGeneratingCandidates}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={handleSelectCandidate}
            />

            {/* 右侧：文章矩阵/评论矩阵 - 占60% */}
            <div className="flex-6 bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="shrink-0 p-6 border-b border-slate-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {toggleState ? 'Feedback Matrix' : 'Essay Matrix'}
                  </h2>
                  {/* 输入框：自定义条件，按 Enter / 按钮 调用 LLM 过滤评论矩阵；筛选生效后同一按钮变为“取消筛选” */}
                  {toggleState && (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type="text"
                          ref={feedbackFilterInputRef}
                          disabled={isFilteringFeedbacks}
                          className="w-48 pl-3 pr-10 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="Enter filter criteria..."
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isFilteringFeedbacks) {
                              // 如果当前已经有筛选结果，则先清除，再重新筛选
                              if (filteredFeedbackKeys !== null) {
                                setFilteredFeedbackKeys(null);
                                setFeedbackFilterError(null);
                              }
                              handleFilterFeedbacks();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (isFilteringFeedbacks) return;
                            // 如果已有筛选结果，则此按钮作为“取消筛选”
                            if (filteredFeedbackKeys !== null) {
                              setFilteredFeedbackKeys(null);
                              setFeedbackFilterError(null);
                              if (feedbackFilterInputRef.current) {
                                feedbackFilterInputRef.current.value = '';
                              }
                              if (matrixScrollRef.current) {
                                matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                              }
                              return;
                            }
                            // 否则执行筛选
                            handleFilterFeedbacks();
                          }}
                          disabled={isFilteringFeedbacks}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={filteredFeedbackKeys !== null ? 'Clear text filter' : 'Filter feedbacks'}
                        >
                          {isFilteringFeedbacks ? (
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : filteredFeedbackKeys !== null ? (
                            // 有筛选结果时，显示“X”图标表示清除
                            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                              <path d="M6 6l8 8M14 6l-8 8" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          ) : (
                            // 默认显示搜索图标
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {/* 筛选按钮 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${filteredChecklistItemIds.size > 0
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      title="Filter to show essays/comments that satisfy checked conditions"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                      Filter
                      {filteredChecklistItemIds.size > 0 && (
                        <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-bold">
                          {filteredChecklistItemIds.size}
                        </span>
                      )}
                    </button>

                    {/* checklist 多选筛选下拉菜单 */}
                    {showFilterDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowFilterDropdown(false)}
                        />
                        <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
                          <div className="p-3 border-b border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-semibold text-slate-900">Filter Conditions</h3>
                              {filteredChecklistItemIds.size > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFilteredChecklistItemIds(new Set());
                                    // 清除筛选时，也清除排序
                                    setSelectedChecklistItemId(null);
                                    if (matrixScrollRef.current) {
                                      matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                                    }
                                  }}
                                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                  Clear All
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              Check checklist items to show only essays/comments that satisfy all checked conditions
                            </p>
                          </div>
                          <div className="p-2 space-y-1">
                            {checklistItems.map((item) => {
                              const isFiltered = filteredChecklistItemIds.has(item.id);
                              return (
                                <label
                                  key={item.id}
                                  className="flex items-start gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isFiltered}
                                    onChange={(e) => {
                                      setFilteredChecklistItemIds((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) {
                                          next.add(item.id);
                                        } else {
                                          next.delete(item.id);
                                        }
                                        return next;
                                      });
                                      // 筛选功能触发时，取消之前的排序功能
                                      setSelectedChecklistItemId(null);
                                      // 滚动文章矩阵到顶部
                                      if (matrixScrollRef.current) {
                                        matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                                      }
                                    }}
                                    className="mt-0.5 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                  />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{item.name}</span>
                                      {isFiltered && (
                                        <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-semibold rounded">
                                          Selected
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                      {item.description || '(Empty)'}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setToggleState(!toggleState)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${toggleState
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                  >
                    Toggle
                  </button>
                </div>
              </div>
              <div ref={matrixScrollRef} className="flex-1 overflow-y-auto p-6">
                <div className="w-full">
                  {/* 表头 */}
                  <div
                    className="grid gap-2 mb-2"
                    style={{ gridTemplateColumns: `50px repeat(${checklistItems.length}, 1fr) 60px` }}
                  >
                    <div></div>
                    {checklistItems.map((item) => {
                      const isSelected = selectedChecklistItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            // 点击表头，切换选中状态
                            if (isSelected) {
                              // 如果已选中，取消选中（恢复默认排序）
                              setSelectedChecklistItemId(null);
                            } else {
                              // 如果未选中，选中该项（满足的排在前面）
                              setSelectedChecklistItemId(item.id);
                              // 排序功能触发时，清除筛选条件，避免冲突
                              setFilteredChecklistItemIds(new Set());
                            }
                            // 滚动文章矩阵到顶部
                            if (matrixScrollRef.current) {
                              matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                          }}
                          className={`text-xs font-semibold text-center p-2 rounded border transition-colors cursor-pointer ${isSelected
                              ? 'text-white border-indigo-600 shadow-md'
                              : 'text-slate-700 border-slate-200 bg-slate-50 hover:bg-slate-100'
                            }`}
                          style={isSelected ? {
                            backgroundColor: getChecklistItemColor(item.id).bg,
                            borderColor: getChecklistItemColor(item.id).border,
                          } : {}}
                          title={item.description}
                        >
                          {item.name}
                        </div>
                      );
                    })}
                    {/* 右侧通用宽度列：新增全局“加号”按钮，行为与左侧 Add 一致 */}
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={handleAddChecklistItem}
                        className="w-full max-w-13 h-full min-h-8 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 text-lg leading-none"
                        title="Add checklist item"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* 根据切换状态显示文章矩阵或评论矩阵（UI 相同：一篇文章一行，可展开） */}
                  <div className="space-y-2">
                    {(!toggleState ? essayChecklistMatrix : feedbackEssayMatrix).map(
                      ({ workIndex, work, checklistStatus }) => {
                          const isExpanded = expandedWorks.has(workIndex);
                          const workPhase2Data = phase2Data[workIndex];
                          const essayParts = workPhase2Data?.essayParts || [];
                          const feedbackMappings = workPhase2Data?.feedbackMappings || [];
                          const essayText = work?.essay || '';
                          const parsedEssay = essayText ? parseEssayText(essayText) : { segments: [] };
                          const hasEssayParts = workPhase2Data?.essayParts && workPhase2Data.essayParts.length > 0;
                          const canExpand = hasEssayParts;

                          const clickedBlockKey = toggleState
                            ? feedbackClickedBlockKey
                            : essayClickedBlockKey;
                          const clickedPartIds = toggleState
                            ? feedbackClickedPartIds
                            : essayClickedPartIds;
                          const activePartKey = toggleState
                            ? feedbackActivePartKey
                            : essayActivePartKey;
                          const activeSegmentIds = toggleState
                            ? feedbackActiveSegmentIds
                            : essayActiveSegmentIds;

                          const setClickedBlockKey = toggleState
                            ? setFeedbackClickedBlockKey
                            : setEssayClickedBlockKey;
                          const setClickedPartIds = toggleState
                            ? setFeedbackClickedPartIds
                            : setEssayClickedPartIds;
                          const setActivePartKey = toggleState
                            ? setFeedbackActivePartKey
                            : setEssayActivePartKey;
                          const setActiveSegmentIds = toggleState
                            ? setFeedbackActiveSegmentIds
                            : setEssayActiveSegmentIds;

                          return (
                            <EssayMatrixRow
                              key={workIndex}
                              workIndex={workIndex}
                              work={work}
                              checklistStatus={checklistStatus}
                              checklistItems={checklistItems}
                              getChecklistItemColor={getChecklistItemColor}
                              isExpanded={isExpanded}
                              canExpand={canExpand}
                              onToggleExpand={toggleExpand}
                              essayParts={essayParts}
                              feedbackMappings={feedbackMappings}
                              parsedEssay={parsedEssay}
                              allFeedbacks={allFeedbacks}
                              hoveredBlockKey={hoveredBlockKey}
                              hoveredPartId={hoveredPartId}
                              hoveredSegmentIds={hoveredSegmentIds}
                              tooltipPosition={tooltipPosition}
                              partRefs={partRefs}
                              onSetHoveredBlockKey={setHoveredBlockKey}
                              onSetHoveredPartId={setHoveredPartId}
                              onSetHoveredSegmentIds={setHoveredSegmentIds}
                              onSetTooltipPosition={setTooltipPosition}
                              clickedBlockKey={clickedBlockKey}
                              onSetClickedBlockKey={setClickedBlockKey}
                              clickedPartIds={clickedPartIds}
                              onSetClickedPartIds={setClickedPartIds}
                              activePartId={activePartKey}
                              onSetActivePartId={setActivePartKey}
                              activeSegmentIds={activeSegmentIds}
                              onSetActiveSegmentIds={setActiveSegmentIds}
                              isFeedbackMode={toggleState}
                            />
                          );
                        }
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
