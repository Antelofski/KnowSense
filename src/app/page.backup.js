'use client';

import { useRef, useState, useMemo, useEffect } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import EssayDisplay from '@/components/EssayDisplay';
import FeedbackPanel from '@/components/FeedbackPanel';
import KnowledgeChecklistModule from '@/components/KnowledgeChecklistModule';
import {
  enrichFeedbackForEssayWithMapping,
  mapFeedbackToEssayParagraphs,
  segmentEssayIntoParts,
  mapFeedbackToKnowledgeChecklist,
  generateKnowledgeChecklistItems,
  fuseFeedbackBlocks,
  generateImage,
  combinedPhase1AndPhase2,
  combinedPhase1AndPhase2Batch,
} from '@/lib/generateFromOpenAI';

// 首次导入时预分析的文章数量（可配置）
const INITIAL_BATCH_ANALYZE_COUNT = 5;

function parseEssayText(text) {
  if (!text) return { segments: [] };
  const colorOrder = ['green', 'red', 'blue', 'orange'];

  // 先按换行符分割成行
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  
  // 合并行，确保每个段落以完整句子（以 . ! ? 结尾）结束
  const paragraphs = [];
  let currentParagraph = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!currentParagraph) {
      // 开始新段落
      currentParagraph = line;
    } else {
      // 追加到当前段落
      currentParagraph += ' ' + line;
    }
    
    // 检查当前段落是否以句子结束符结尾（. ! ?）
    // 英文文章主要使用 . 作为句子结束符
    const endsWithSentenceEnd = /[.!?]\s*$/.test(currentParagraph.trim());
    
    if (endsWithSentenceEnd) {
      // 段落以完整句子结束，保存并开始新段落
      paragraphs.push(currentParagraph.trim());
      currentParagraph = '';
    }
    // 如果最后一行没有以句子结束符结尾，也要保存（可能是文章结尾）
    else if (i === lines.length - 1) {
      paragraphs.push(currentParagraph.trim());
    }
  }
  
  // 过滤空段落
  const validParagraphs = paragraphs.filter((p) => p.length > 0);

  const segments = validParagraphs.map((p, index) => ({
    id: index + 1,
    text: p,
    color: colorOrder[index % colorOrder.length],
  }));

  return { segments };
}

function parseFeedbackText(text) {
  if (!text) return [];
  const colorOrder = ['green', 'red', 'blue', 'orange'];

  // 找到第一个以 "CONCEPTS" 或 "Concepts" 开头的行，从那里开始解析
  // 第一行通常是介绍性文字，不是真正的 feedback
  const lines = text.split('\n');
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    // 检查是否以 "CONCEPTS" 或 "Concepts" 开头（不区分大小写）
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
    // 过滤掉 OVERALL SCORE
    if (/^OVERALL SCORE\b/i.test(firstLine)) return false;
    
    if (hasAnyPointsFormat) {
      // 如果整个文本中有 "(x pts)" 格式，则只保留包含 "(x pts)" 的块
      const hasPointsFormat = /\(\d+\s*pts?\)/i.test(block);
      if (!hasPointsFormat) return false;
    }
    // 如果整个文本中没有 "(x pts)" 格式，则保留所有块（除了 OVERALL SCORE）
    return true;
  });

  return effectiveBlocks.map((block, index) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    
    // 识别第一行是否是大写标题（包含冒号、全大写、或者包含 "(x pts)" 格式）
    const firstLine = lines[0] || '';
    // 判断是否为大写标题的规则：
    // 1. 包含冒号（如 "CONCISENESS: Exceeds (10 pts)"）
    // 2. 全大写且长度较短（如 "CONCEPTS & APPLICATION"）
    // 3. 包含 "(x pts)" 格式
    const isTitleLine = 
      firstLine.includes(':') ||  // 包含冒号
      (/^[A-Z\s&]+$/.test(firstLine) && firstLine.length < 100) ||  // 全大写且较短（允许空格和&）
      /\(\d+\s*pts?\)/i.test(firstLine);  // 包含 "(x pts)" 格式
    
    // 如果第一行是标题，跳过它，只使用后面的内容
    let contentLines = lines;
    let title = '';
    if (isTitleLine && lines.length > 1) {
      // 第一行是标题，跳过它，只使用后面的内容
      title = firstLine;
      contentLines = lines.slice(1);
    } else if (isTitleLine && lines.length === 1) {
      // 只有标题行，没有内容，跳过这个block（返回null，后面过滤掉）
      return null;
    } else {
      // 第一行不是标题，全部作为内容
      contentLines = lines;
      title = '';  // 没有标题，设置为空字符串
    }
    
    const bodyText = contentLines.join('\n');
    const hasBody = contentLines.length > 0 && bodyText.trim().length > 0;
    // 只使用内容部分，不再使用标题作为fallback
    let mainText = bodyText.trim();
    
    // 如果没有有效内容，跳过这个block
    if (!mainText) {
      return null;
    }
    
    // 清理多余的*号和-号（markdown列表标记）
    // 去掉每行开头的 "- " 或 "* " 标记，但保留行内容
    mainText = mainText
      .split('\n')
      .map(line => {
        // 去掉行首的 "-" 或 "*" 符号（包括后面可能有空格的情况）
        // 匹配：行首的 "-" 或 "*" 后面可能跟空格，然后保留剩余内容
        // 如果整行只有符号（可能带空格），则返回空字符串
        const trimmed = line.trim();
        // 匹配行首的 "-" 或 "*"，后面可能跟空格，然后保留剩余内容
        const cleaned = trimmed.replace(/^[-*]\s*/, '');
        return cleaned;
      })
      .filter(line => line.length > 0) // 过滤掉空行（包括只有符号的行）
      .join('\n')
      .trim();
    
    // 如果清理后没有有效内容，跳过这个block
    if (!mainText) {
      return null;
    }
    
    // 额外检查：如果内容看起来还是标题格式（包含冒号、全大写、或包含 "(x pts)"），也不应该被当作feedback
    const stillLooksLikeTitle = 
      mainText.includes(':') && mainText.length < 150 ||  // 包含冒号且较短
      (/^[A-Z\s&]+$/.test(mainText) && mainText.length < 100) ||  // 全大写且较短
      /\(\d+\s*pts?\)/i.test(mainText);  // 包含 "(x pts)" 格式
    
    // 如果内容看起来还是标题格式，跳过这个block
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

    return {
      id: index + 1,
      title: title || '',  // 标题可以为空
      text: mainText,
      color: colorOrder[index % colorOrder.length],
      hasBody,
      isLowInfo,
      isNegative,
      relatedSegments: [], // 这一步先不建立对应关系
      // 初始不展开多选项，后面交给 AI 生成更丰富的评语
      expandedOptions: [],
    };
  }).filter(Boolean);  // 过滤掉 null 值
}

export default function Home() {

  // 使用本地存储保存数据
  const [essayData, setEssayData] = useLocalStorageState('essayData', {
    defaultValue: { segments: [] },
  });
  const [feedbackData, setFeedbackData] = useLocalStorageState('feedbackData', {
    defaultValue: [],
  });
  const [studentWorks, setStudentWorks] = useLocalStorageState('studentWorks', {
    defaultValue: [],
  });
  const [modelWorks, setModelWorks] = useLocalStorageState('modelWorks', {
    defaultValue: [],
  });
  const [knowledgeList, setKnowledgeList] = useLocalStorageState('knowledgeList', {
    defaultValue: [],
  });
  const [currentWorkIndex, setCurrentWorkIndex] = useLocalStorageState('currentWorkIndex', {
    defaultValue: 0,
  });
  // analyzedWorks 需要转换为数组存储（Set不能直接序列化）
  const [analyzedWorksArray, setAnalyzedWorksArray] = useLocalStorageState('analyzedWorks', {
    defaultValue: [],
  });
  const [worksData, setWorksData] = useLocalStorageState('worksData', {
    defaultValue: {},
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

  // 阶段相关状态
  const [phase, setPhase] = useLocalStorageState('phase', {
    defaultValue: 'phase1', // 'phase1', 'phase2', 或 'phase3'
  });
  // 全局知识清单（所有文章共享）
  const [globalChecklistItems, setGlobalChecklistItems] = useLocalStorageState('globalChecklistItems', {
    defaultValue: [], // 全局知识清单项数组
  });
  // 全局标准分段结构模板（所有文章共享：只保存id/name/description，不保存具体段落ID）
  // 用于保证每篇文章的分段数量和结构一致
  const [globalEssayPartsTemplate, setGlobalEssayPartsTemplate] = useLocalStorageState(
    'globalEssayPartsTemplate',
    {
      defaultValue: [], // [{ id, name, description }]
    }
  );
  // 每篇文章的阶段二数据独立存储（不包含知识清单，知识清单是全局的）
  const [phase2Data, setPhase2Data] = useLocalStorageState('phase2Data', {
    defaultValue: {}, // { workIndex: { essayParts, feedbackMappings } }
  });
  const [phase2Loading, setPhase2Loading] = useState(false);
  // 阶段三生成的图片结果：按文章索引存储
  const [phase3ImagesByWork, setPhase3ImagesByWork] = useLocalStorageState('phase3Images', {
    defaultValue: {}, // { [workIndex]: { [checklistId]: base64 } }
  });

  // 当前文章的阶段二数据
  const currentPhase2Data = phase2Data[currentWorkIndex] || {
    essayParts: [],
    feedbackMappings: [],
  };
  const essayParts = currentPhase2Data.essayParts || [];
  // const checklistItems = globalChecklistItems; // 使用全局知识清单
  const feedbackMappings = currentPhase2Data.feedbackMappings || [];

  // UI状态不需要持久化
  const [expandedFeedbackId, setExpandedFeedbackId] = useState(null);
  const [hoveredSegmentId, setHoveredSegmentId] = useState(null);
  const [hoveredFeedbackId, setHoveredFeedbackId] = useState(null);
  const [hoveredPartId, setHoveredPartId] = useState(null);
  const [enrichingFeedbackId, setEnrichingFeedbackId] = useState(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  // 按文章索引的loading状态（Set<workIndex>）
  const [analyzingWorks, setAnalyzingWorks] = useState(new Set());
  // 阶段三相关UI状态
  const [selectedChecklistId, setSelectedChecklistId] = useState(null);
  const [generatingImageFor, setGeneratingImageFor] = useState(null);
  const [enlargedImage, setEnlargedImage] = useState(null); // 放大的图片base64
  // 当前文章对应的阶段三图片
  const currentComicImages = phase3ImagesByWork[currentWorkIndex] || {};
  // 页面刷新后的续跑标记（只执行一次）
  const resumePendingRef = useRef(false);

  // ESC键关闭放大图片
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && enlargedImage) {
        setEnlargedImage(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [enlargedImage]);

  // 页面重新加载时，如果存在未完成的文章分析，则在后台继续批量生成（不影响已完成文章的切换）
  useEffect(() => {
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
        const modelEssaysForAi = (modelWorks || []).map((model) => ({
          essay: model.essay || '',
        }));
        const checklistItemsForInit = globalChecklistItems || [];
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
                  title: f.title,
                  text: f.text,
                })),
              });
            });

            if (worksForAi.length === 0) return;

            const combinedResult = await combinedPhase1AndPhase2Batch(
              worksForAi,
              modelEssaysForAi,
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
              if (!finalParts || finalParts.length === 0) {
                finalParts = parsedEssay.segments.map((seg, idx2) => ({
                  id: idx2 + 1,
                  name: `Part ${idx2 + 1}`,
                  description: `Section ${idx2 + 1} of the essay`,
                  paragraph_ids: [seg.id],
                }));
              }

              if (!templateUpdated && (!globalEssayPartsTemplate || globalEssayPartsTemplate.length === 0) && finalParts.length > 0) {
                const templateToSave = finalParts.map((part) => ({
                  id: part.id,
                  name: part.name,
                  description: part.description,
                }));
                setGlobalEssayPartsTemplate(templateToSave);
                templateUpdated = true;
              }

              const phase2Mappings = phase1Mappings.map((m) => ({
                feedback_id: m.feedback_id,
                checklist_items: m.checklist_items || [],
                essay_part_ids: m.essay_part_ids || [],
              }));

              const dataForWork = { essayData: parsedEssay, feedbackData: mappedFeedbacks };
              setWorksData((prev) => ({ ...prev, [idx]: dataForWork }));
              setAnalyzedWorks((prev) => {
                const next = new Set(prev);
                next.add(idx);
                return next;
              });
              setPhase2Data((prev) => ({
                ...prev,
                [idx]: {
                  essayParts: finalParts,
                  feedbackMappings: phase2Mappings,
                },
              }));
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
  }, [
    studentWorks,
    analyzedWorks,
    phase2Data,
    modelWorks,
    globalChecklistItems,
    globalEssayPartsTemplate,
    analyzingWorks,
  ]);

  // 筛选相关状态
  const [filteringWorks, setFilteringWorks] = useState(false);
  const [filterError, setFilterError] = useState(null); // 筛选错误信息
  // worksWithLowInfoNegative 需要转换为数组存储（Set不能直接序列化）
  const [worksWithLowInfoNegativeArray, setWorksWithLowInfoNegativeArray] = useLocalStorageState('worksWithLowInfoNegative', {
    defaultValue: [],
  });
  const [showOnlyLowInfoNegative, setShowOnlyLowInfoNegative] = useLocalStorageState('showOnlyLowInfoNegative', {
    defaultValue: false,
  });

  // 将数组转换为Set使用（用于内部逻辑）
  const worksWithLowInfoNegative = useMemo(() => new Set(worksWithLowInfoNegativeArray), [worksWithLowInfoNegativeArray]);
  const setWorksWithLowInfoNegative = (updater) => {
    if (typeof updater === 'function') {
      setWorksWithLowInfoNegativeArray((prev) => {
        const prevSet = new Set(prev);
        const newSet = updater(prevSet);
        return Array.from(newSet);
      });
    } else {
      setWorksWithLowInfoNegativeArray(Array.from(updater));
    }
  };

  const fileInputRef = useRef(null);
  const isInitializedRef = useRef(false);
  const essayScrollRef = useRef(null); // 文章滚动容器ref
  const feedbackScrollRef = useRef(null); // Feedback滚动容器ref

  // 页面首次加载时，如果有保存的数据，自动恢复当前文章
  useEffect(() => {
    // 使用 ref 确保只执行一次，避免在切换文章时被重新触发
    if (isInitializedRef.current) return;
    
    if (studentWorks.length > 0 && 
        currentWorkIndex >= 0 && 
        currentWorkIndex < studentWorks.length &&
        essayData.segments.length === 0 && 
        feedbackData.length === 0) {
      // 如果当前文章已分析，从缓存加载
      if (analyzedWorks.has(currentWorkIndex)) {
        const cached = worksData[currentWorkIndex];
        if (cached) {
          setEssayData(cached.essayData);
          setFeedbackData(cached.feedbackData);
        }
      } else {
        // 如果当前文章未分析且没有显示数据，显示未分析状态
        const currentWork = studentWorks[currentWorkIndex];
        if (currentWork) {
          const essayText = currentWork.essay || '';
          const feedbackText = currentWork.feedbacks || '';
          const parsedEssay = parseEssayText(essayText);
          const parsedFeedbacks = parseFeedbackText(feedbackText);
          setEssayData(parsedEssay);
          setFeedbackData(parsedFeedbacks);
        }
      }
      isInitializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时执行一次

  // 注意：不再监听 currentWorkIndex 的变化，完全由 handleWorkChange 和 analyzeWork 控制
  // 这样可以避免 useLocalStorageState 在重新渲染时读取旧值导致数据被重置

  const handleExpandFeedback = (feedbackId) => {
    setExpandedFeedbackId(expandedFeedbackId === feedbackId ? null : feedbackId);
  };

   const hoveredFeedback = feedbackData.find((f) => f.id === hoveredFeedbackId);
   const hoveredFeedbackSegmentIds =
     hoveredFeedback && hoveredFeedback.relatedSegments?.length
       ? hoveredFeedback.relatedSegments
       : [];
  
  // 颜色池（固定顺序，保证稳定）
  const baseColors = useMemo(() => ['green', 'red', 'blue', 'orange'], []);

  // 使用 useMemo 确保颜色映射只在当前文章数据变化时重新计算，保证每篇文章独立
  // 改为：先为每条评语分配颜色，然后让该评语关联的所有段落使用相同颜色（一对一关系）
  const { segmentColorMap, feedbackColorMap } = useMemo(() => {
    // 先为每条评语分配一个唯一的颜色（基于评语ID）
    const fbColorMap = new Map();
    feedbackData.forEach((feedback, index) => {
      if (feedback.relatedSegments && feedback.relatedSegments.length > 0) {
        // 基于评语索引分配颜色，确保每条评语有唯一颜色
        const color = baseColors[index % baseColors.length];
        fbColorMap.set(feedback.id, color);
      }
    });

    // 然后让每条评语关联的所有段落都使用该评语的颜色
    // 如果多个评语关联到同一段落，使用第一个评语的颜色
    const segColorMap = new Map();
    if (essayData?.segments?.length && feedbackData?.length) {
      essayData.segments.forEach((segment) => {
        // 找到第一个关联到该段落的评语
        const firstFeedback = feedbackData.find((f) => 
          f.relatedSegments && f.relatedSegments.includes(segment.id)
        );
        if (firstFeedback && fbColorMap.has(firstFeedback.id)) {
          // 使用该评语的颜色
          segColorMap.set(segment.id, fbColorMap.get(firstFeedback.id));
        }
      });
    }

    return { segmentColorMap: segColorMap, feedbackColorMap: fbColorMap };
  }, [essayData, feedbackData, baseColors]); // 只在当前文章和评语数据变化时重新计算

  // 根据筛选状态决定实际展示的文章列表
  const filteredStudentWorks = useMemo(() => {
    if (!showOnlyLowInfoNegative) {
      return studentWorks;
    }
    return studentWorks.filter((_, index) => worksWithLowInfoNegative.has(index));
  }, [studentWorks, showOnlyLowInfoNegative, worksWithLowInfoNegative]);

  // 当前文章在筛选后的索引（与未筛选的实际索引分离）
  const [currentFilteredIndex, setCurrentFilteredIndex] = useState(0);
  // 保存开启筛选前的实际文章索引，用于关闭筛选时恢复
  const [preFilterWorkIndex, setPreFilterWorkIndex] = useState(null);
  // 保存筛选时的筛选索引位置，用于再次开启筛选时恢复
  const [preFilterFilteredIndex, setPreFilterFilteredIndex] = useState(null);

  // 决定实际展示的评语列表，并排序：有色块的排在前面，有信息量的排在前面
  const visibleFeedbacks = useMemo(() => {
    const filtered = feedbackData;
    
    // 排序：有色块的（有relatedSegments且长度>0）排在前面，有信息量的（isLowInfo为false）排在前面
    return [...filtered].sort((a, b) => {
      // 首先按是否有色块排序
      const aHasColor = a.relatedSegments && a.relatedSegments.length > 0;
      const bHasColor = b.relatedSegments && b.relatedSegments.length > 0;
      
      if (aHasColor && !bHasColor) return -1; // a有色块，b没有，a排在前面
      if (!aHasColor && bHasColor) return 1;  // a没有色块，b有，b排在前面
      
      // 如果都有色块或都没有色块，按信息量排序
      const aHasInfo = !a.isLowInfo;
      const bHasInfo = !b.isLowInfo;
      
      if (aHasInfo && !bHasInfo) return -1; // a有信息量，b没有，a排在前面
      if (!aHasInfo && bHasInfo) return 1;   // a没有信息量，b有，b排在前面
      
      return 0; // 其他情况保持原顺序
    });
  }, [feedbackData]);

  // 清空所有数据
  const handleClearData = () => {
    const hasData = 
      (essayData.segments && essayData.segments.length > 0) ||
      feedbackData.length > 0 ||
      studentWorks.length > 0 ||
      globalChecklistItems.length > 0;
    
    if (!hasData) {
      alert('There is no data to clear.');
      return;
    }
    
    const confirmed = confirm('Are you sure you want to clear ALL data? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    
    // 清空所有状态
    setExpandedFeedbackId(null);
    setHoveredSegmentId(null);
    setHoveredFeedbackId(null);
    setHoveredPartId(null);
    setPhase2Loading(false);
    
    // 清空所有持久化状态
    setAnalyzedWorksArray([]);
    setWorksData({});
    setCurrentWorkIndex(0);
    setEssayData({ segments: [] });
    setFeedbackData([]);
    setStudentWorks([]);
    setModelWorks([]);
    setKnowledgeList([]);
    setPhase2Data({});
    setPhase('phase1');
    setGlobalChecklistItems([]);
    setGlobalEssayPartsTemplate([]); // 清空全局分段模板
    setWorksWithLowInfoNegativeArray([]);
    setShowOnlyLowInfoNegative(false);
    
    // 清空 localStorage
    window.localStorage.clear();
    
    alert('All data has been cleared.');
  };

  const handleImportClick = () => {
    // 检查是否有数据
    const hasData = 
      (essayData.segments && essayData.segments.length > 0) ||
      feedbackData.length > 0 ||
      studentWorks.length > 0 ||
      globalChecklistItems.length > 0;
    
    if (hasData) {
      alert('Please clear existing data before importing new JSON. Click "Clear Data" first.');
      return;
    }
    
    fileInputRef.current?.click();
  };

  // 分析所有文章，找出有低信息量且负面评语的文章
  // 直接使用解析结果进行筛选，不再调用LLM
  const handleAnalyzeAllWorksForLowInfoNegative = async (worksOverride = null) => {
    // 使用传入的数据或状态中的数据
    const worksToAnalyze = worksOverride || studentWorks;
    
    if (worksToAnalyze.length === 0) return;
    
    // 如果已经有缓存结果，直接返回
    if (worksWithLowInfoNegative.size > 0) {
      return;
    }
    
    setFilteringWorks(true);
    setFilterError(null); // 清除之前的错误
    try {
      // 直接解析所有文章的feedback，并筛选符合条件的文章
      const workIds = worksToAnalyze
        .map((work, index) => {
          const feedbackText = work.feedbacks || '';
          // 如果没有feedback，跳过
          if (!feedbackText.trim()) return null;
          
          // 解析feedback（已经在解析时标记了isLowInfo和isNegative）
          const parsedFeedbacks = parseFeedbackText(feedbackText);
          
          // 检查是否有至少一个低信息量评语 AND 至少一个负面评语
          const hasLowInfo = parsedFeedbacks.some((f) => f.isLowInfo);
          const hasNegative = parsedFeedbacks.some((f) => f.isNegative);
          
          // 只有同时有低信息量和负面评语的文章才符合条件
          if (hasLowInfo && hasNegative) {
            return index;
          }
          
          return null;
        })
        .filter((id) => id !== null);
      
      // 输出详细信息到控制台，方便查看效果
      if (workIds.length > 0) {
        console.log('=== 筛选结果 ===');
        console.log(`筛选出的作品IDs (同时有低信息量和负面反馈):`, workIds);
      }
      
      // 转换为Set
      const worksWithNegative = new Set(workIds);
      setWorksWithLowInfoNegative(worksWithNegative);
    } catch (error) {
      console.error('Error analyzing works for filter:', error);
      setFilterError('Failed to analyze works for filter. Please try again later.');
    } finally {
      setFilteringWorks(false);
    }
  };

  // 分析指定索引的文章（使用合并的阶段一和阶段二）
  const analyzeWork = async (workIndex, workOverride = null, autoInitPhase2 = false, checklistItemsOverride = null) => {
    if (analyzedWorks.has(workIndex)) {
      // 已分析，直接加载
      const cached = worksData[workIndex];
      if (cached) {
        // 确保清除所有hover和展开状态，避免前一篇的影响
        setExpandedFeedbackId(null);
        setHoveredSegmentId(null);
        setHoveredFeedbackId(null);
        setEssayData(cached.essayData);
        setFeedbackData(cached.feedbackData);
      }
      // 如果已分析且需要自动初始化阶段二，检查是否需要初始化
      if (autoInitPhase2) {
        // 检查是否已有阶段二数据
        if (!phase2Data[workIndex] || !phase2Data[workIndex].essayParts?.length) {
          // 使用缓存的数据直接初始化阶段二
          const currentEssayData = cached?.essayData || essayData;
          const currentFeedbackData = cached?.feedbackData || feedbackData;
          if (currentEssayData?.segments?.length && currentFeedbackData?.length) {
            await initializePhase2(false, currentEssayData, currentFeedbackData, workIndex, checklistItemsOverride);
          }
        }
      }
      return;
    }

    const work = workOverride || studentWorks[workIndex];
    if (!work) return;

    const essayText = work.essay || '';
    const feedbackText = work.feedbacks || '';

    const parsedEssay = parseEssayText(essayText);
    const parsedFeedbacks = parseFeedbackText(feedbackText);

    // 先切换显示文章和评语（未分析状态）
    // 确保清除所有hover和展开状态，避免前一篇的影响
    setExpandedFeedbackId(null);
    setHoveredSegmentId(null);
    setHoveredFeedbackId(null);
    setEssayData(parsedEssay);
    setFeedbackData(parsedFeedbacks);
    
    // 如果所有评语都只有标题没有正文，就直接展示，不调用 AI 建立对应关系
    const hasAnyBody = parsedFeedbacks.some((f) => f.hasBody);
    if (!hasAnyBody) {
      const data = { essayData: parsedEssay, feedbackData: parsedFeedbacks };
      setWorksData((prev) => ({ ...prev, [workIndex]: data }));
      setAnalyzedWorks((prev) => {
        const newSet = new Set(prev);
        newSet.add(workIndex);
        return newSet;
      });
      // 如果需要自动初始化阶段二，直接使用解析好的数据
      if (autoInitPhase2) {
        await initializePhase2(false, parsedEssay, parsedFeedbacks, workIndex, checklistItemsOverride);
      }
      return;
    }

    // 使用合并的阶段一和阶段二处理
    try {
      setMappingLoading(true);
      setPhase2Loading(true);
      
      const paragraphsForAi = parsedEssay.segments.map((s) => ({
        id: s.id,
        text: s.text,
      }));
      const feedbackItemsForAi = parsedFeedbacks.map((f) => ({
        id: f.id,
        title: f.title,
        text: f.text,
      }));
      const modelEssaysForAi = modelWorks.map((model) => ({
        essay: model.essay || '',
      }));
      const templateForAi = globalEssayPartsTemplate && globalEssayPartsTemplate.length > 0
        ? globalEssayPartsTemplate
        : null;
      const checklistItemsForAi = checklistItemsOverride !== null 
        ? checklistItemsOverride 
        : globalChecklistItems;

      // 调用合并的函数，同时处理阶段一和阶段二
      const combinedResult = await combinedPhase1AndPhase2(
        paragraphsForAi,
        feedbackItemsForAi,
        modelEssaysForAi,
        templateForAi,
        checklistItemsForAi
      );

      // 处理阶段一的结果：评语到段落的映射
      const phase1Mappings = combinedResult.feedback_mappings || [];
      const mappingById = new Map();
      phase1Mappings.forEach((m) => {
        // 只取第一个段落ID，确保只定位一处
        const paragraphIds = m.related_paragraph_ids || [];
        const firstParagraphId = paragraphIds.length > 0 ? [paragraphIds[0]] : [];
        mappingById.set(m.feedback_id, firstParagraphId);
      });

      const mappedFeedbacks = parsedFeedbacks.map((f) => ({
        ...f,
        relatedSegments: mappingById.get(f.id) || [],
      }));

      // 处理阶段二的结果：文章分段
      const phase2Segments = combinedResult.essay_segments || [];
      let finalParts = phase2Segments;
      if (finalParts.length === 0) {
        // 如果分段失败，使用原始段落作为部分
        finalParts = parsedEssay.segments.map((seg, idx) => ({
          id: idx + 1,
          name: `Part ${idx + 1}`,
          description: `Section ${idx + 1} of the essay`,
          paragraph_ids: [seg.id],
        }));
      }

      // 如果还没有全局模板，且这次分段成功，保存为模板
      if (globalEssayPartsTemplate.length === 0 && finalParts.length > 0) {
        const templateToSave = finalParts.map((part) => ({
          id: part.id,
          name: part.name,
          description: part.description,
        }));
        setGlobalEssayPartsTemplate(templateToSave);
      }

      // 处理阶段二的结果：评语到知识清单和文章部分的映射
      const phase2Mappings = phase1Mappings.map((m) => ({
        feedback_id: m.feedback_id,
        checklist_items: m.checklist_items || [],
        essay_part_ids: m.essay_part_ids || [],
      }));

      // 保存阶段一数据
      const data = { essayData: parsedEssay, feedbackData: mappedFeedbacks };
      setEssayData(parsedEssay);
      setFeedbackData(mappedFeedbacks);
      setWorksData((prev) => ({ ...prev, [workIndex]: data }));
      setAnalyzedWorks((prev) => {
        const newSet = new Set(prev);
        newSet.add(workIndex);
        return newSet;
      });

      // 保存阶段二数据
      setPhase2Data((prev) => ({
        ...prev,
        [workIndex]: {
          essayParts: finalParts,
          feedbackMappings: phase2Mappings,
        },
      }));
    } catch (error) {
      console.error('combined phase1 and phase2 error', error);
      alert('Failed to analyze the essay and feedback. Please try again later.');
    } finally {
      setMappingLoading(false);
      setPhase2Loading(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      // 如果没有选择文件，也要清空input值
      event.target.value = '';
      return;
    }

    // 在开始处理文件之前，立即清空所有状态
    // 这样可以确保每次导入都是干净的状态，完全重置
    setExpandedFeedbackId(null);
    setHoveredSegmentId(null);
    setHoveredFeedbackId(null);
    setHoveredPartId(null);
    setPhase2Loading(false);
    
    // 清空所有持久化状态（确保完全重置）
    setAnalyzedWorksArray([]);
    setWorksData({});
    setCurrentWorkIndex(0);
    setEssayData({ segments: [] });
    setFeedbackData([]);
    setStudentWorks([]); // 先清空，避免旧数据残留
    setModelWorks([]); // 先清空
    setKnowledgeList([]); // 先清空
    setPhase2Data({});
    setPhase('phase1');
    setGlobalChecklistItems([]); // 先清空全局知识清单
    setGlobalEssayPartsTemplate([]); // 清空全局分段模板
    setWorksWithLowInfoNegativeArray([]); // 清空筛选结果
    setShowOnlyLowInfoNegative(false); // 重置筛选状态
    window.localStorage.clear();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result;
        const data = JSON.parse(content);

        // 检查是否是新的data.json格式（包含modelWorks和studentWorks）
        if (data.studentWorks && Array.isArray(data.studentWorks)) {
          // 新格式：data.json
          // 先标记所有文章为"正在处理中"，避免useEffect重复处理
          const allIndices = data.studentWorks.map((_, idx) => idx);
          setAnalyzingWorks(new Set(allIndices));
          
          // 先设置基础数据
          setStudentWorks(data.studentWorks);
          
          // 保存modelWorks（如果有）
          if (data.modelWorks && Array.isArray(data.modelWorks)) {
            setModelWorks(data.modelWorks);
          } else {
            setModelWorks([]);
          }
          
          // 保存knowledgeList（如果有）
          if (data.knowledgeList && Array.isArray(data.knowledgeList)) {
            setKnowledgeList(data.knowledgeList);
            // 初始化全局知识清单（从data.json导入时，完全替换为文件中的knowledgeList，确保数量匹配）
            const checklistItems = data.knowledgeList.map((item, index) => ({
              id: index + 1,
              name: `C${index + 1}`,
              description: item || '',
            }));
            setGlobalChecklistItems(checklistItems);
          } else {
            setKnowledgeList([]);
            setGlobalChecklistItems([]);
          }
          // 只显示第一篇，并在后台批量分析前 N 篇（默认 5 篇）并初始化阶段二（单次 LLM 调用）
          if (data.studentWorks.length > 0) {
            const firstWork = data.studentWorks[0];
            const essayText = firstWork.essay || '';
            const feedbackText = firstWork.feedbacks || '';
            const parsedEssay = parseEssayText(essayText);
            const parsedFeedbacks = parseFeedbackText(feedbackText);
            // 先显示第一篇的未分析数据，保证首屏渲染尽快完成
            setEssayData(parsedEssay);
            setFeedbackData(parsedFeedbacks);
            
            // 准备知识清单数据（使用局部变量，避免状态更新延迟）
            const checklistItemsForInit = data.knowledgeList && Array.isArray(data.knowledgeList)
              ? data.knowledgeList.map((item, index) => ({
                  id: index + 1,
                  name: `C${index + 1}`,
                  description: item || '',
                }))
              : [];
            
            // 计算需要预分析的篇数（可控）
            const maxToAnalyze = Math.min(
              INITIAL_BATCH_ANALYZE_COUNT,
              data.studentWorks.length
            );

            // 构造批量请求所需的 works 数组，并同时缓存各篇解析结果，方便回填
            const worksForBatch = [];
            const parsedEssaysByIndex = new Map();
            const parsedFeedbacksByIndex = new Map();

            for (let i = 0; i < maxToAnalyze; i++) {
              const work = data.studentWorks[i];
              if (!work) continue;

              const wEssayText = work.essay || '';
              const wFeedbackText = work.feedbacks || '';

              // 第 1 篇已经解析过，直接复用，其他篇单独解析
              const wParsedEssay = i === 0 ? parsedEssay : parseEssayText(wEssayText);
              const wParsedFeedbacks = i === 0 ? parsedFeedbacks : parseFeedbackText(wFeedbackText);

              parsedEssaysByIndex.set(i, wParsedEssay);
              parsedFeedbacksByIndex.set(i, wParsedFeedbacks);

              const paragraphsForAi = wParsedEssay.segments.map((s) => ({
                id: s.id,
                text: s.text,
              }));
              const feedbackItemsForAi = wParsedFeedbacks.map((f) => ({
                id: f.id,
                title: f.title,
                text: f.text,
              }));

              worksForBatch.push({
                work_id: i,
                paragraphs: paragraphsForAi,
                feedback_items: feedbackItemsForAi,
              });
            }

            // 批量分析函数（可复用）
            const processBatch = async (worksBatch, startIdx, modelEssaysForAi, templateForAi, checklistItemsForInit, currentGlobalTemplate) => {
              const batchWorksForAi = [];
              const batchParsedEssays = new Map();
              const batchParsedFeedbacks = new Map();
              
              // 标记这批文章为analyzing
              setAnalyzingWorks((prev) => {
                const newSet = new Set(prev);
                worksBatch.forEach((_, offset) => {
                  newSet.add(startIdx + offset);
                });
                return newSet;
              });

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
                      title: f.title,
                      text: f.text,
                    })),
                  });
                }

                if (batchWorksForAi.length === 0) return;

                const combinedResult = await combinedPhase1AndPhase2Batch(
                  batchWorksForAi,
                  modelEssaysForAi,
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

                  // 阶段一：feedback 映射到段落
                  const phase1Mappings = workResult.feedback_mappings || [];
                  const mappingById = new Map();
                  phase1Mappings.forEach((m) => {
                    const paragraphIds = m.related_paragraph_ids || [];
                    const firstParagraphId = paragraphIds.length > 0 ? [paragraphIds[0]] : [];
                    mappingById.set(m.feedback_id, firstParagraphId);
                  });

                  const mappedFeedbacks = wParsedFeedbacks.map((f) => ({
                    ...f,
                    relatedSegments: mappingById.get(f.id) || [],
                  }));

                  // 阶段二：文章分段
                  const phase2Segments = workResult.essay_segments || [];
                  let finalParts = phase2Segments;
                  if (!finalParts || finalParts.length === 0) {
                    finalParts = wParsedEssay.segments.map((seg, idx2) => ({
                      id: idx2 + 1,
                      name: `Part ${idx2 + 1}`,
                      description: `Section ${idx2 + 1} of the essay`,
                      paragraph_ids: [seg.id],
                    }));
                  }

                  // 如全局模板尚未建立，且当前有有效分段，则用当前分段结构初始化模板（只在第一次）
                  if (!templateUpdated && currentGlobalTemplate.length === 0 && finalParts.length > 0) {
                    const templateToSave = finalParts.map((part) => ({
                      id: part.id,
                      name: part.name,
                      description: part.description,
                    }));
                    setGlobalEssayPartsTemplate(templateToSave);
                    templateUpdated = true;
                  }

                  // 阶段二：feedback 到知识清单和文章部分的映射
                  const phase2Mappings = phase1Mappings.map((m) => ({
                    feedback_id: m.feedback_id,
                    checklist_items: m.checklist_items || [],
                    essay_part_ids: m.essay_part_ids || [],
                  }));

                  // 保存阶段一结果到缓存
                  const dataForWork = { essayData: wParsedEssay, feedbackData: mappedFeedbacks };
                  setWorksData((prev) => {
                    const updated = { ...prev, [idx]: dataForWork };
                    // 如果是第1篇，立即更新界面显示
                    if (idx === 0 && startIdx === 0) {
                      setEssayData(wParsedEssay);
                      setFeedbackData(mappedFeedbacks);
                    }
                    return updated;
                  });
                  setAnalyzedWorks((prev) => {
                    const newSet = new Set(prev);
                    newSet.add(idx);
                    return newSet;
                  });

                  // 保存阶段二数据
                  setPhase2Data((prev) => ({
                    ...prev,
                    [idx]: {
                      essayParts: finalParts,
                      feedbackMappings: phase2Mappings,
                    },
                  }));
                });
              } catch (err) {
                console.error(`Batch analysis error for works ${startIdx}-${startIdx + worksBatch.length - 1}:`, err);
                // 不弹窗，避免打断用户操作
              } finally {
                // 移除这批文章的analyzing标记
                setAnalyzingWorks((prev) => {
                  const newSet = new Set(prev);
                  worksBatch.forEach((_, offset) => {
                    newSet.delete(startIdx + offset);
                  });
                  return newSet;
                });
              }
            };

            // 先处理第一批（前N篇）
            if (worksForBatch.length > 0) {
              try {
                // 只对第1篇显示全局loading（因为它在界面上）
                setMappingLoading(true);
                setPhase2Loading(true);

                const modelEssaysForAi = (data.modelWorks || []).map((model) => ({
                  essay: model.essay || '',
                }));
                const templateForAi =
                  globalEssayPartsTemplate && globalEssayPartsTemplate.length > 0
                    ? globalEssayPartsTemplate
                    : null;

                await processBatch(
                  data.studentWorks.slice(0, maxToAnalyze),
                  0,
                  modelEssaysForAi,
                  templateForAi,
                  checklistItemsForInit,
                  globalEssayPartsTemplate
                );
                // 第1篇的界面更新已在processBatch内部完成
              } catch (err) {
                console.error('First batch analysis error:', err);
                alert('Failed to analyze the first batch of essays and feedback. Please try again later.');
              } finally {
                setMappingLoading(false);
                setPhase2Loading(false);
              }
            }

            // 异步继续处理剩余文章（分批，每批5篇）
            if (data.studentWorks.length > maxToAnalyze) {
              (async () => {
                const modelEssaysForAi = (data.modelWorks || []).map((model) => ({
                  essay: model.essay || '',
                }));
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
                    modelEssaysForAi,
                    currentTemplate,
                    checklistItemsForInit,
                    currentTemplate || []
                  );
                }
              })();
            }

            // 异步分析所有文章，找出有低信息量且负面评语的文章（传入works避免状态更新延迟问题）
            handleAnalyzeAllWorksForLowInfoNegative(data.studentWorks);
          }
        } else if (data.essay || data.feedbacks) {
          // 旧格式：example.json（兼容旧格式）
          // 清除学生作品和范文数据
          setStudentWorks([]);
          setModelWorks([]);
          
          const essayText = data.essay || '';
          const feedbackText = data.feedbacks || '';
          const parsedEssay = parseEssayText(essayText);
          const parsedFeedbacks = parseFeedbackText(feedbackText);

          // 如果所有评语都只有标题没有正文，就直接展示，不调用 AI 建立对应关系
          const hasAnyBody = parsedFeedbacks.some((f) => f.hasBody);
          if (!hasAnyBody) {
            setEssayData(parsedEssay);
            setFeedbackData(parsedFeedbacks);
            return;
          }

          // 使用 AI 精细识别：每条评语对应哪些段落
          (async () => {
            try {
              setMappingLoading(true);
              const paragraphsForAi = parsedEssay.segments.map((s) => ({
                id: s.id,
                text: s.text,
              }));
              const feedbackItemsForAi = parsedFeedbacks.map((f) => ({
                id: f.id,
                title: f.title,
                text: f.text,
              }));

              const result = await mapFeedbackToEssayParagraphs(
                paragraphsForAi,
                feedbackItemsForAi
              );

              const mappingById = new Map();
              (result.mappings || []).forEach((m) => {
                // 只取第一个段落ID，确保只定位一处
                const paragraphIds = m.related_paragraph_ids || [];
                const firstParagraphId = paragraphIds.length > 0 ? [paragraphIds[0]] : [];
                mappingById.set(m.feedback_id, firstParagraphId);
              });

              const mappedFeedbacks = parsedFeedbacks.map((f) => ({
                ...f,
                relatedSegments: mappingById.get(f.id) || [],
              }));

              setEssayData(parsedEssay);
              setFeedbackData(mappedFeedbacks);
            } catch (error) {
              console.error('map feedback to essay error', error);
              alert('Failed to analyze relations between essay and feedback. Please import the JSON file again.');
            } finally {
              setMappingLoading(false);
            }
          })();
        } else {
          alert('Import failed: JSON format is invalid. It must contain essay/feedbacks or studentWorks fields.');
        }
      } catch (error) {
        console.error('解析 JSON 失败', error);
        alert('Import failed: JSON is not in a valid format.');
      } finally {
        // 允许重复选择同一个文件
        event.target.value = '';
      }
    };

    reader.readAsText(file, 'utf-8');
  };

  // 切换文章
  // isActualIndex: 如果为true，表示传入的是实际索引；如果为false或undefined，表示传入的是筛选后的索引
  const handleWorkChange = async (newIndex, isActualIndex = false) => {
    // 先计算实际索引
    let actualIndex = newIndex;
    if (showOnlyLowInfoNegative && !isActualIndex) {
      // 筛选模式下：newIndex 是筛选后的索引，需要映射回实际索引
      const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
      if (newIndex < 0 || newIndex >= sortedFilteredIndices.length) return;
      actualIndex = sortedFilteredIndices[newIndex];
    }
    
    if (actualIndex < 0 || actualIndex >= studentWorks.length) return;
    
    // 检查目标文章是否已解析（阶段一和阶段二都完成）
    const isAnalyzed = analyzedWorks.has(actualIndex);
    const hasPhase2Data = phase2Data[actualIndex] && 
      (phase2Data[actualIndex].essayParts?.length > 0 || phase2Data[actualIndex].feedbackMappings?.length > 0);
    const isFullyAnalyzed = isAnalyzed && hasPhase2Data;
    
    // 如果未解析，不允许切换
    if (!isFullyAnalyzed) {
      alert(`Essay ${actualIndex + 1} is still being analyzed. Please wait for it to complete.`);
      return;
    }
    
    // 保存当前阶段
    const currentPhase = phase;
    
    // 如果当前在阶段二，先检查目标文章是否有阶段二数据
    if (currentPhase === 'phase2') {
      const targetPhase2Data = phase2Data[actualIndex];
      // 检查是否有阶段二数据（有essayParts或feedbackMappings）
      const hasPhase2Data = targetPhase2Data && 
        (targetPhase2Data.essayParts?.length > 0 || targetPhase2Data.feedbackMappings?.length > 0);
      
      if (!hasPhase2Data) {
        // 没有阶段二数据，立即切换到阶段一，避免显示空的阶段二内容
        setPhase('phase1');
      }
    }
    
    // 先清除UI状态，避免显示旧文章的数据
    setExpandedFeedbackId(null);
    setHoveredSegmentId(null);
    setHoveredFeedbackId(null);
    setHoveredPartId(null);
    setSelectedChecklistId(null);
    setGeneratingImageFor(null);
    
    // 重置滚动位置到顶部
    if (essayScrollRef.current) {
      essayScrollRef.current.scrollTop = 0;
    }
    if (feedbackScrollRef.current) {
      feedbackScrollRef.current.scrollTop = 0;
    }
    
    // 先更新 currentWorkIndex，这样序号会立即更新
    // 注意：设置 currentWorkIndex 可能会触发 useLocalStorageState 的重新渲染
    // 但由于我们已经移除了监听 currentWorkIndex 的 useEffect，不会导致数据被重置
    setCurrentWorkIndex(actualIndex);
    // 同步更新筛选索引（只有在筛选模式下才需要更新）
    if (showOnlyLowInfoNegative) {
      // 根据实际索引反推在筛选列表中的位置
      const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
      const idx = sortedFilteredIndices.indexOf(actualIndex);
      if (idx >= 0) {
        setCurrentFilteredIndex(idx);
      }
    }
    // 注意：未筛选时，currentFilteredIndex 已经在关闭筛选时被设置，这里不需要再次设置
    
    // 然后分析新文章（如果未分析），确保数据加载完成
    // 注意：在 analyzeWork 中会设置 essayData 和 feedbackData
    // 阶段一完成后自动生成阶段二
    await analyzeWork(actualIndex, null, true, globalChecklistItems);
    
    // 数据加载完成后，如果之前是阶段二且目标文章有阶段二数据，保持在阶段二
    if (currentPhase === 'phase2') {
      const targetPhase2Data = phase2Data[actualIndex];
      const hasPhase2Data = targetPhase2Data && 
        (targetPhase2Data.essayParts?.length > 0 || targetPhase2Data.feedbackMappings?.length > 0);
      
      if (hasPhase2Data) {
        // 有阶段二数据，保持在阶段二
        setPhase('phase2');
      }
      // 如果没有阶段二数据，已经在上面切换到阶段一了，这里不需要再处理
    } else {
      // 如果当前在阶段一，切换文章时保持在阶段一
      setPhase('phase1');
    }
  };

  const handleEnrichFeedback = async (feedbackId) => {
    const target = feedbackData.find((f) => f.id === feedbackId);
    if (!target) return;

    const title = target.title || '';
    const current = target.text || '';

    // 准备modelWorks作为参考（只传递essay文本）
    const modelWorksForAi = modelWorks.map((model) => ({
      essay: model.essay || '',
    }));

    setEnrichingFeedbackId(feedbackId);
    try {
      const result = await enrichFeedbackForEssayWithMapping(
        title,
        current,
        modelWorksForAi,
        target.isLowInfo || false
      );

      let options = Array.isArray(result.options) ? result.options : [];
      // 只保留有效的选项（有text字段）
      options = options.filter(
        (opt) =>
          opt &&
          typeof opt.text === 'string' &&
          opt.text.trim().length > 0
      );

      if (!options.length) {
        alert(
          'The model could not generate any feedback options.'
        );
        return;
      }

      // 不直接替换，而是保存选项让用户选择
      setFeedbackData((prev) =>
        prev.map((f) =>
          f.id === feedbackId
            ? {
                ...f,
                expandedOptions: options,
              }
            : f
        )
      );
      setExpandedFeedbackId(feedbackId);
    } catch (error) {
      console.error('enrich feedback error', error);
      alert('Failed to enrich feedback. Please try again later.');
    } finally {
      setEnrichingFeedbackId(null);
    }
  };

  const handleSelectEnrichedFeedback = async (feedbackId, selectedIndex) => {
    // 改为多选：selectedIndex 实际为索引数组
    if (
      selectedIndex === null ||
      selectedIndex === undefined ||
      (Array.isArray(selectedIndex) && selectedIndex.length === 0)
    )
      return;
    const target = feedbackData.find((f) => f.id === feedbackId);
    if (!target || !target.expandedOptions) return;

    const indices = Array.isArray(selectedIndex) ? selectedIndex : [selectedIndex];
    const selectedOptions = indices
      .map((idx) => target.expandedOptions[idx])
      .filter(Boolean);

    if (!selectedOptions.length) return;

    const selectedText = selectedOptions
      .map((opt) => (typeof opt === 'string' ? opt : opt.text))
      .join('\n');

    // 替换评语文本
    setFeedbackData((prev) =>
      prev.map((f) =>
        f.id === feedbackId
          ? {
              ...f,
              text: selectedText,
              expandedOptions: [], // 清空选项
              // 经过 AI 丰富后，这条评语一定有正文，可参与段落高亮，信息量充足
              hasBody: true,
              isLowInfo: false,
            }
          : f
      )
    );

    setExpandedFeedbackId(null);
  };

  const handleCancelEnrichFeedback = (feedbackId) => {
    setFeedbackData((prev) =>
      prev.map((f) =>
        f.id === feedbackId
          ? {
              ...f,
              expandedOptions: [], // 清空选项
            }
          : f
      )
    );
    setExpandedFeedbackId(null);
    // 清空该评语的选择状态（在 FeedbackPanel 中通过 key 重置）
  };

  // 获取某个知识清单项在阶段二中的格子对应的反馈内容
  const getContentForChecklistItem = (checklistId) => {
    if (!checklistId) {
      return { hasContent: false, feedbackTexts: [] };
    }

    const relatedMappings = (feedbackMappings || []).filter(
      (m) =>
        Array.isArray(m.checklist_items) &&
        m.checklist_items.includes(checklistId)
    );

    if (!relatedMappings.length) {
      return { hasContent: false, feedbackTexts: [] };
    }

    const feedbackTexts = relatedMappings
      .map((m) => feedbackData.find((f) => f.id === m.feedback_id))
      .filter(Boolean)
      .map((f) => (f.text || '').trim())
      .filter((t) => t.length > 0);

    return {
      hasContent: feedbackTexts.length > 0,
      feedbackTexts,
    };
  };

  // 阶段三：根据选中的知识点生成/重新生成漫画
  const handleGenerateComic = async () => {
    if (!selectedChecklistId) return;

    const checklist = globalChecklistItems.find(
      (item) => item.id === selectedChecklistId
    );
    if (!checklist) return;

    const { hasContent, feedbackTexts } = getContentForChecklistItem(
      selectedChecklistId
    );

    if (!hasContent) {
      alert(
        'This knowledge item has no feedback blocks in Phase 2. Please drag some related feedback into this column before generating.'
      );
      return;
    }

    // 组装传给 generateImage 的内容列表
    const contentList = [
      `Knowledge：${checklist.description || checklist.name}`,
      ...feedbackTexts.map((txt, idx) => `Example${idx + 1}：${txt}`),
    ];
    
    try {
      setGeneratingImageFor(selectedChecklistId);
      const b64 = await generateImage(contentList);
      // 按文章索引保存到本地（localStorage），不同文章互不影响
      setPhase3ImagesByWork((prev) => {
        const prevForWork = prev[currentWorkIndex] || {};
        const updatedForWork = {
          ...prevForWork,
          [selectedChecklistId]: b64,
        };
        return {
          ...prev,
          [currentWorkIndex]: updatedForWork,
        };
      });
    } catch (error) {
      console.error('generate comic error', error);
      alert('Failed to generate image. Please try again later.');
    } finally {
      setGeneratingImageFor(null);
    }
  };

  const handleDeleteFeedback = (feedbackId) => {
    setFeedbackData((prev) =>
      prev.filter((f) => f.id !== feedbackId)
    );
    if (expandedFeedbackId === feedbackId) {
      setExpandedFeedbackId(null);
    }
    if (hoveredFeedbackId === feedbackId) {
      setHoveredFeedbackId(null);
    }
  };

  // 切换到阶段二时，初始化知识清单
  const initializePhase2 = async (forceRefill = false, essayDataOverride = null, feedbackDataOverride = null, workIndexOverride = null, checklistItemsOverride = null) => {
    // 使用传入的参数或当前状态
    const targetEssayData = essayDataOverride || essayData;
    const targetFeedbackData = feedbackDataOverride || feedbackData;
    const targetWorkIndex = workIndexOverride !== null ? workIndexOverride : currentWorkIndex;
    const targetChecklistItems =
      checklistItemsOverride !== null ? checklistItemsOverride : globalChecklistItems;
    
    // 检查数据是否存在且有效
    if (!targetEssayData || !targetEssayData.segments || targetEssayData.segments.length === 0 || 
        !targetFeedbackData || targetFeedbackData.length === 0) {
      // 只有在确实没有数据时才提示，避免在切换文章时误报
      if (studentWorks.length === 0) {
        alert('Please import essay and feedback data first.');
      }
      return false;
    }

    // 检查是否已经初始化过（除非强制重新填充）
    if (!forceRefill && phase2Data[targetWorkIndex] && 
        phase2Data[targetWorkIndex].essayParts.length > 0) {
      // 已初始化，直接返回成功（不重新填充）
      return true;
    }

    setPhase2Loading(true);
    try {
      // 1. 如果还没有全局分段模板，优先用 modelWorks 来生成统一模板
      if ((!globalEssayPartsTemplate || globalEssayPartsTemplate.length === 0) && modelWorks.length > 0) {
        try {
          const baseModelEssay = modelWorks[0]?.essay || '';
          if (baseModelEssay && baseModelEssay.trim().length > 0) {
            // 复用同一套分段逻辑来解析 modelWorks[0]
            const modelParsed = parseEssayText(baseModelEssay);
            const modelParagraphs = (modelParsed.segments || []).map((s) => ({
              id: s.id,
              text: s.text,
            }));
            if (modelParagraphs.length > 0) {
              // 其余范文作为参考结构
              const otherModelEssays = modelWorks.slice(1).map((m) => ({
                essay: m.essay || '',
              }));
              const templateSegResult = await segmentEssayIntoParts(
                modelParagraphs,
                otherModelEssays
              );
              let templateSegments = templateSegResult.segments || [];
              // 如果 LLM 分段失败，就把每个段落当成一个 part
              if (templateSegments.length === 0) {
                templateSegments = modelParagraphs.map((seg, idx) => ({
                  id: idx + 1,
                  name: `Part ${idx + 1}`,
                  description: `Section ${idx + 1} of the model essay`,
                  paragraph_ids: [seg.id],
                }));
              }
              // 只保存结构信息：id/name/description
              if (templateSegments.length > 0) {
                const templateToSave = templateSegments.map((part) => ({
                  id: part.id,
                  name: part.name,
                  description: part.description,
                }));
                setGlobalEssayPartsTemplate(templateToSave);
              }
            }
          }
        } catch (e) {
          console.error('Generate globalEssayPartsTemplate from modelWorks failed', e);
          // 如果失败，不中断后续流程，继续用当前文章自适应分段
        }
      }

      // 2. 文章分段（参考modelWorks + 可选统一模板）
      const paragraphsForSegmentation = targetEssayData.segments.map((s) => ({
        id: s.id,
        text: s.text,
      }));
      const modelEssaysForSegmentation = modelWorks.map((model) => ({
        essay: model.essay || '',
      }));
      // 如果已有全局分段模板，则传入，保证所有文章分段数量和结构一致
      const templateForSegmentation =
        globalEssayPartsTemplate && globalEssayPartsTemplate.length > 0
          ? globalEssayPartsTemplate
          : null;
      
      const segmentationResult = await segmentEssayIntoParts(
        paragraphsForSegmentation,
        modelEssaysForSegmentation,
        templateForSegmentation
      );
      const parts = segmentationResult.segments || [];
      
      // 如果分段失败，使用原始段落作为部分
      let finalParts = parts;
      if (finalParts.length === 0) {
        finalParts = targetEssayData.segments.map((seg, idx) => ({
          id: idx + 1,
          name: `Part ${idx + 1}`,
          description: `Section ${idx + 1} of the essay`,
          paragraph_ids: [seg.id],
        }));
      }

      // 如果没有 modelWorks 时，且还没有全局模板，而这次分段成功，则退而用当前文章结构作为模板
      if (
        (!globalEssayPartsTemplate || globalEssayPartsTemplate.length === 0) &&
        finalParts.length > 0 &&
        modelWorks.length === 0
      ) {
        const templateToSave = finalParts.map((part) => ({
          id: part.id,
          name: part.name,
          description: part.description,
        }));
        setGlobalEssayPartsTemplate(templateToSave);
      }

      // 3. 映射评语到知识清单（根据评语和知识清单对应，且找到对应段落填充）
      // 过滤掉没有信息量的评语（isLowInfo === true）
      const validFeedbacks = targetFeedbackData.filter((f) => !f.isLowInfo);
      
      // 如果没有知识清单项，提示用户
      if (!targetChecklistItems || targetChecklistItems.length === 0) {
        console.warn('No knowledge checklist items available. Mapping will be empty.');
      }
      
      const mappingResult = await mapFeedbackToKnowledgeChecklist(
        finalParts,
        validFeedbacks,
        targetChecklistItems
      );

      // 保存到当前文章的阶段二数据（不包含知识清单，知识清单是全局的）
      setPhase2Data((prev) => ({
        ...prev,
        [targetWorkIndex]: {
          essayParts: finalParts,
          feedbackMappings: mappingResult.mappings || [],
        },
      }));

      return true; // 成功返回 true
    } catch (error) {
      console.error('初始化阶段二失败', error);
      alert('Failed to initialize the knowledge checklist module. Please check your network and try again later.');
      return false; // 失败返回 false
    } finally {
      setPhase2Loading(false);
    }
  };

  // 切换阶段（阶段一和阶段二已经在 analyzeWork 中同时生成，这里只做 UI 切换）
  const handlePhaseChange = (newPhase) => {
    // 切换到阶段三时，检查是否完成阶段二
    if (newPhase === 'phase3') {
      const currentPhase2Data = phase2Data[currentWorkIndex];
      const hasPhase2Data = currentPhase2Data && 
        (currentPhase2Data.essayParts?.length > 0 || currentPhase2Data.feedbackMappings?.length > 0);
      
      if (!hasPhase2Data) {
        alert('Please complete Phase 2 first before entering Phase 3.');
        return; // 不切换阶段
      }
    }
    
    setPhase(newPhase);

    // 阶段切换时，将左右滚动容器滚动到顶部
    if (essayScrollRef.current) {
      essayScrollRef.current.scrollTop = 0;
    }
    if (feedbackScrollRef.current) {
      feedbackScrollRef.current.scrollTop = 0;
    }
  };

  // 融合反馈块（返回结果，不直接添加）
  const handleFuseBlocks = async (feedback1, feedback2, parts, essayText, existingResult = null) => {
    try {
      // 如果已有结果（用户确认时传入），直接使用并添加
      if (existingResult && existingResult.new_checklist_item) {
        // 用户已确认，添加新的知识清单项到全局知识清单
        const newId = globalChecklistItems.length > 0 
          ? Math.max(...globalChecklistItems.map((item) => item.id)) + 1
          : 1;
        // 使用动态计算的编号，确保与融合画布标题一致
        const correctItemName = `C${newId}`;
        const newItem = {
          id: newId,
          name: correctItemName,
          description: existingResult.new_checklist_item.description,
        };
        setGlobalChecklistItems((prev) => [...prev, newItem]);
        return existingResult; // 返回结果供组件使用
      } else if (!existingResult) {
        // 没有结果，调用API生成（但不添加，只返回结果供用户确认）
        const result = await fuseFeedbackBlocks(feedback1, feedback2, parts, essayText);
        return result; // 只返回结果，不添加
      }
      return existingResult;
    } catch (error) {
      console.error('融合反馈块失败', error);
      throw error; // 抛出错误，让组件处理
    }
  };

  // 添加知识清单项（全局）
  const handleAddChecklistItem = () => {
    const newId = globalChecklistItems.length > 0 
      ? Math.max(...globalChecklistItems.map((item) => item.id)) + 1
      : 1;
    const newItem = {
      id: newId,
      name: `C${newId}`,
      description: 'New knowledge checklist item',
    };
    setGlobalChecklistItems((prev) => [...prev, newItem]);
  };

  // 编辑知识清单项（全局）
  const handleEditChecklistItem = (itemId, newDescription) => {
    setGlobalChecklistItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, description: newDescription } : item
      )
    );
  };

  // 删除知识清单项（全局）
  const handleDeleteChecklistItem = (itemId) => {
    setGlobalChecklistItems((prev) => prev.filter((item) => item.id !== itemId));
    // 同时更新所有文章的 feedbackMappings，移除对该知识清单项的引用
    setPhase2Data((prev) => {
      const updated = {};
      Object.keys(prev).forEach((workIndex) => {
        const workData = prev[workIndex];
        updated[workIndex] = {
          ...workData,
          feedbackMappings: (workData.feedbackMappings || [])
            .map((mapping) => ({
              ...mapping,
              checklist_items: mapping.checklist_items.filter((id) => id !== itemId),
            }))
            .filter((mapping) => mapping.checklist_items.length > 0),
        };
      });
      return updated;
    });
  };

  // 判断是否有数据：如果有文章列表，或者当前有显示的文章和评语数据
  const hasData =
    studentWorks.length > 0 ||
    ((essayData.segments && essayData.segments.length > 0) && feedbackData.length > 0);

  // 阶段三中当前选中知识点是否在阶段二有对应格子内容
  const selectedChecklistInfo = selectedChecklistId
    ? getContentForChecklistItem(selectedChecklistId)
    : { hasContent: false, feedbackTexts: [] };
  const selectedChecklistHasContent = selectedChecklistInfo.hasContent;

  return (
    <div className="h-screen bg-linear-to-br from-slate-100 via-white to-slate-100 flex flex-col overflow-hidden">
      <div className="max-w-6xl mx-auto w-full flex flex-col flex-1 overflow-hidden px-8 py-8">
        {/* 标题部分 - 固定不滚动 */}
        <div className="flex-shrink-0 mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              {phase === 'phase1' 
                ? 'Phase 1 · Enrich Feedback' 
                : phase === 'phase2' 
                ? 'Phase 2 · Build Knowledge Checklist'
                : 'Phase 3 · Generate Educational Comics'}
            </h1>
            <p className="mt-2 text-sm md:text-base text-slate-500">
              {phase === 'phase1'
                ? 'Import a student essay and rubric feedback, then hover and refine comments with AI assistance.'
                : phase === 'phase2'
                ? 'Build a knowledge checklist based on existing articles and comments.'
                : 'Generate educational comics based on the knowledge checklist.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasData && <div className="flex items-center gap-2 bg-slate-100 rounded-full p-1">
              <button
                type="button"
                onClick={() => handlePhaseChange('phase1')}
                disabled={phase2Loading || mappingLoading}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                  phase === 'phase1'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                } ${phase2Loading || mappingLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Phase 1
              </button>
              <button
                type="button"
                onClick={() => handlePhaseChange('phase2')}
                disabled={phase2Loading || mappingLoading}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                  phase === 'phase2'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                } ${phase2Loading || mappingLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Phase 2
                {phase2Loading && ' (Loading...)'}
              </button>
              <button
                type="button"
                onClick={() => handlePhaseChange('phase3')}
                disabled={phase2Loading || mappingLoading}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                  phase === 'phase3'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                } ${phase2Loading || mappingLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Phase 3
              </button>
            </div>}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFileChange}
              disabled={phase2Loading || mappingLoading}
            />
            <button
              type="button"
              onClick={handleImportClick}
              disabled={phase2Loading || mappingLoading}
              className={`inline-flex items-center rounded-full border border-indigo-200 bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 hover:border-indigo-300 transition-colors ${phase2Loading || mappingLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleClearData}
              disabled={phase2Loading || mappingLoading}
              className={`inline-flex items-center rounded-full border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500 hover:border-red-300 transition-colors ${phase2Loading || mappingLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Clear Data
            </button>
          </div>
        </div>
        {!hasData ? (
          <div className="flex-1 overflow-hidden flex items-center justify-center">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-10 py-12 text-center shadow-sm max-w-xl">
              <p className="text-lg font-medium text-slate-700 mb-2">
                {mappingLoading
                  ? 'Analyzing relations between essay and feedback…'
                  : 'Please import an essay and feedback JSON file to get started.'}
              </p>
              {!mappingLoading && (
                <p className="text-sm text-slate-500">
                  The essay will appear on the left with highlighted segments, and rubric feedback will be shown on the right.
                </p>
              )}
            </div>
          </div>
        ) : phase === 'phase1' ? (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Student Essay
                </h2>
                {studentWorks.length > 0 && (
                  <div className="flex items-center gap-3">
                    {filteringWorks ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Filtering...
                      </span>
                    ) : filterError ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {filterError}
                      </span>
                    ) : worksWithLowInfoNegative.size > 0 ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (showOnlyLowInfoNegative) {
                            // 关闭筛选：保存当前筛选索引位置，恢复到开启筛选前的文章索引
                            setPreFilterFilteredIndex(currentFilteredIndex);
                            const targetIndex = preFilterWorkIndex !== null ? preFilterWorkIndex : currentWorkIndex;
                            setPreFilterWorkIndex(null);
                            // 先关闭筛选状态
                            setShowOnlyLowInfoNegative(false);
                            // 同步更新筛选索引为实际索引（在状态更新后）
                            setCurrentFilteredIndex(targetIndex);
                            // 然后切换到目标文章
                            await handleWorkChange(targetIndex, true);
                          } else {
                            // 开启筛选：保存当前索引，跳转到筛选后的第一篇（或上次筛选时的位置）
                            setPreFilterWorkIndex(currentWorkIndex);
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            
                            // 如果有保存的筛选索引位置，恢复到那个位置；否则跳到第一篇
                            let targetFilteredIndex = 0;
                            let targetActualIndex = sortedFilteredIndices[0];
                            
                            if (preFilterFilteredIndex !== null && preFilterFilteredIndex < sortedFilteredIndices.length) {
                              // 恢复到上次筛选时的位置
                              targetFilteredIndex = preFilterFilteredIndex;
                              targetActualIndex = sortedFilteredIndices[preFilterFilteredIndex];
                            }
                            
                            if (targetActualIndex !== undefined) {
                              // 先开启筛选状态
                              setShowOnlyLowInfoNegative(true);
                              // 设置筛选索引
                              setCurrentFilteredIndex(targetFilteredIndex);
                              // 然后切换到目标文章
                              await handleWorkChange(targetActualIndex, true);
                            }
                          }
                        }}
                        disabled={mappingLoading || filteringWorks || phase2Loading}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          showOnlyLowInfoNegative
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                        } ${mappingLoading || filteringWorks || phase2Loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span>
                          {showOnlyLowInfoNegative
                            ? `Show only low-info negative (${worksWithLowInfoNegative.size})`
                            : 'Show only low-info negative'}
                        </span>
                      </button>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex - 1 : currentWorkIndex - 1;
                          if (showOnlyLowInfoNegative) {
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                              const actualTargetIndex = sortedFilteredIndices[targetIndex];
                              const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                              const hasPhase2Data = phase2Data[actualTargetIndex] && 
                                (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                              if (!isAnalyzed || !hasPhase2Data) {
                                return; // 禁用切换
                              }
                            }
                          } else {
                            const actualTargetIndex = targetIndex;
                            const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                            const hasPhase2Data = phase2Data[actualTargetIndex] && 
                              (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                            if (!isAnalyzed || !hasPhase2Data) {
                              return; // 禁用切换
                            }
                          }
                          handleWorkChange(targetIndex);
                        }}
                        disabled={
                          (showOnlyLowInfoNegative
                            ? currentFilteredIndex === 0
                            : currentWorkIndex === 0)
                          || (() => {
                            const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex - 1 : currentWorkIndex - 1;
                            if (showOnlyLowInfoNegative) {
                              const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                              if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                                const actualTargetIndex = sortedFilteredIndices[targetIndex];
                                return !analyzedWorks.has(actualTargetIndex) || 
                                  !(phase2Data[actualTargetIndex] && 
                                    (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                              }
                            } else {
                              const actualTargetIndex = targetIndex;
                              return !analyzedWorks.has(actualTargetIndex) || 
                                !(phase2Data[actualTargetIndex] && 
                                  (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                            }
                            return false;
                          })()
                        }
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Previous essay"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="text-sm text-slate-500 min-w-15 text-center">
                        {showOnlyLowInfoNegative
                          ? `${currentFilteredIndex + 1} / ${filteredStudentWorks.length} (${studentWorks.length} total)`
                          : `${currentWorkIndex + 1} / ${studentWorks.length}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex + 1 : currentWorkIndex + 1;
                          if (showOnlyLowInfoNegative) {
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                              const actualTargetIndex = sortedFilteredIndices[targetIndex];
                              const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                              const hasPhase2Data = phase2Data[actualTargetIndex] && 
                                (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                              if (!isAnalyzed || !hasPhase2Data) {
                                return; // 禁用切换
                              }
                            }
                          } else {
                            const actualTargetIndex = targetIndex;
                            const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                            const hasPhase2Data = phase2Data[actualTargetIndex] && 
                              (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                            if (!isAnalyzed || !hasPhase2Data) {
                              return; // 禁用切换
                            }
                          }
                          handleWorkChange(targetIndex);
                        }}
                        disabled={
                          (showOnlyLowInfoNegative
                            ? currentFilteredIndex >= filteredStudentWorks.length - 1
                            : currentWorkIndex >= studentWorks.length - 1)
                          || (() => {
                            const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex + 1 : currentWorkIndex + 1;
                            if (showOnlyLowInfoNegative) {
                              const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                              if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                                const actualTargetIndex = sortedFilteredIndices[targetIndex];
                                return !analyzedWorks.has(actualTargetIndex) || 
                                  !(phase2Data[actualTargetIndex] && 
                                    (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                              }
                            } else {
                              const actualTargetIndex = targetIndex;
                              return !analyzedWorks.has(actualTargetIndex) || 
                                !(phase2Data[actualTargetIndex] && 
                                  (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                            }
                            return false;
                          })()
                        }
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Next essay"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div ref={essayScrollRef} className="flex-1 overflow-y-auto p-6 pt-4">
                <EssayDisplay
                  essay={essayData}
                  hoveredSegmentId={hoveredSegmentId}
                  hoveredFeedbackSegmentIds={hoveredFeedbackSegmentIds}
                  segmentColorMap={segmentColorMap}
                  feedbackColorMap={feedbackColorMap}
                  hoveredFeedbackId={hoveredFeedbackId}
                  onHoverSegment={setHoveredSegmentId}
                />
              </div>
            </div>

            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Feedback
                </h2>
                <div className="flex items-center gap-3">
                  {mappingLoading && (
                    <span className="text-xs text-indigo-500">
                      Analyzing relations between feedback and essay…
                    </span>
                  )}
                </div>
              </div>
              <div ref={feedbackScrollRef} className="flex-1 overflow-y-auto p-6 pt-4">
                <FeedbackPanel
                  feedbacks={visibleFeedbacks}
                  expandedFeedbackId={expandedFeedbackId}
                  hoveredSegmentId={hoveredSegmentId}
                  hoveredFeedbackId={hoveredFeedbackId}
                  feedbackColorMap={feedbackColorMap}
                  onExpandFeedback={handleExpandFeedback}
                  onEnrichFeedback={handleEnrichFeedback}
                  onSelectEnrichedFeedback={handleSelectEnrichedFeedback}
                  onCancelEnrichFeedback={handleCancelEnrichFeedback}
                  enrichingFeedbackId={enrichingFeedbackId}
                  onHoverFeedback={setHoveredFeedbackId}
                  onDeleteFeedback={handleDeleteFeedback}
                  mappingLoading={mappingLoading}
                />
              </div>
            </div>
          </div>
        ) :phase === 'phase2' ? (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Student Essay
                </h2>
                {studentWorks.length > 0 && (
                  <div className="flex items-center gap-3">
                    {filteringWorks ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Filtering...
                      </span>
                    ) : filterError ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {filterError}
                      </span>
                    ) : worksWithLowInfoNegative.size > 0 ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (showOnlyLowInfoNegative) {
                            // 关闭筛选：保存当前筛选索引位置，恢复到开启筛选前的文章索引
                            setPreFilterFilteredIndex(currentFilteredIndex);
                            const targetIndex = preFilterWorkIndex !== null ? preFilterWorkIndex : currentWorkIndex;
                            setPreFilterWorkIndex(null);
                            // 先关闭筛选状态
                            setShowOnlyLowInfoNegative(false);
                            // 同步更新筛选索引为实际索引（在状态更新后）
                            setCurrentFilteredIndex(targetIndex);
                            // 然后切换到目标文章
                            await handleWorkChange(targetIndex, true);
                          } else {
                            // 开启筛选：保存当前索引，跳转到筛选后的第一篇（或上次筛选时的位置）
                            setPreFilterWorkIndex(currentWorkIndex);
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            
                            // 如果有保存的筛选索引位置，恢复到那个位置；否则跳到第一篇
                            let targetFilteredIndex = 0;
                            let targetActualIndex = sortedFilteredIndices[0];
                            
                            if (preFilterFilteredIndex !== null && preFilterFilteredIndex < sortedFilteredIndices.length) {
                              // 恢复到上次筛选时的位置
                              targetFilteredIndex = preFilterFilteredIndex;
                              targetActualIndex = sortedFilteredIndices[preFilterFilteredIndex];
                            }
                            
                            if (targetActualIndex !== undefined) {
                              // 先开启筛选状态
                              setShowOnlyLowInfoNegative(true);
                              // 设置筛选索引
                              setCurrentFilteredIndex(targetFilteredIndex);
                              // 然后切换到目标文章
                              await handleWorkChange(targetActualIndex, true);
                            }
                          }
                        }}
                        disabled={mappingLoading || filteringWorks || phase2Loading}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          showOnlyLowInfoNegative
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                        } ${mappingLoading || filteringWorks || phase2Loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span>
                          {showOnlyLowInfoNegative
                            ? `Show only low-info negative (${worksWithLowInfoNegative.size})`
                            : 'Show only low-info negative'}
                        </span>
                      </button>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex - 1 : currentWorkIndex - 1;
                          if (showOnlyLowInfoNegative) {
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                              const actualTargetIndex = sortedFilteredIndices[targetIndex];
                              const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                              const hasPhase2Data = phase2Data[actualTargetIndex] && 
                                (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                              if (!isAnalyzed || !hasPhase2Data) {
                                return; // 禁用切换
                              }
                            }
                          } else {
                            const actualTargetIndex = targetIndex;
                            const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                            const hasPhase2Data = phase2Data[actualTargetIndex] && 
                              (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                            if (!isAnalyzed || !hasPhase2Data) {
                              return; // 禁用切换
                            }
                          }
                          handleWorkChange(targetIndex);
                        }}
                        disabled={
                          (showOnlyLowInfoNegative
                            ? currentFilteredIndex === 0
                            : currentWorkIndex === 0)
                          || (() => {
                            const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex - 1 : currentWorkIndex - 1;
                            if (showOnlyLowInfoNegative) {
                              const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                              if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                                const actualTargetIndex = sortedFilteredIndices[targetIndex];
                                return !analyzedWorks.has(actualTargetIndex) || 
                                  !(phase2Data[actualTargetIndex] && 
                                    (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                              }
                            } else {
                              const actualTargetIndex = targetIndex;
                              return !analyzedWorks.has(actualTargetIndex) || 
                                !(phase2Data[actualTargetIndex] && 
                                  (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                            }
                            return false;
                          })()
                        }
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Previous essay"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="text-sm text-slate-500 min-w-15 text-center">
                        {showOnlyLowInfoNegative
                          ? `${currentFilteredIndex + 1} / ${filteredStudentWorks.length} (${studentWorks.length} total)`
                          : `${currentWorkIndex + 1} / ${studentWorks.length}`}
                        {analyzingWorks.has(currentWorkIndex) && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-indigo-500">
                            <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analyzing...
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex + 1 : currentWorkIndex + 1;
                          if (showOnlyLowInfoNegative) {
                            const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                            if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                              const actualTargetIndex = sortedFilteredIndices[targetIndex];
                              const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                              const hasPhase2Data = phase2Data[actualTargetIndex] && 
                                (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                              if (!isAnalyzed || !hasPhase2Data) {
                                return; // 禁用切换
                              }
                            }
                          } else {
                            const actualTargetIndex = targetIndex;
                            const isAnalyzed = analyzedWorks.has(actualTargetIndex);
                            const hasPhase2Data = phase2Data[actualTargetIndex] && 
                              (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0);
                            if (!isAnalyzed || !hasPhase2Data) {
                              return; // 禁用切换
                            }
                          }
                          handleWorkChange(targetIndex);
                        }}
                        disabled={
                          (showOnlyLowInfoNegative
                            ? currentFilteredIndex >= filteredStudentWorks.length - 1
                            : currentWorkIndex >= studentWorks.length - 1)
                          || (() => {
                            const targetIndex = showOnlyLowInfoNegative ? currentFilteredIndex + 1 : currentWorkIndex + 1;
                            if (showOnlyLowInfoNegative) {
                              const sortedFilteredIndices = Array.from(worksWithLowInfoNegative).sort((a, b) => a - b);
                              if (targetIndex >= 0 && targetIndex < sortedFilteredIndices.length) {
                                const actualTargetIndex = sortedFilteredIndices[targetIndex];
                                return !analyzedWorks.has(actualTargetIndex) || 
                                  !(phase2Data[actualTargetIndex] && 
                                    (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                              }
                            } else {
                              const actualTargetIndex = targetIndex;
                              return !analyzedWorks.has(actualTargetIndex) || 
                                !(phase2Data[actualTargetIndex] && 
                                  (phase2Data[actualTargetIndex].essayParts?.length > 0 || phase2Data[actualTargetIndex].feedbackMappings?.length > 0));
                            }
                            return false;
                          })()
                        }
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Next essay"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div ref={essayScrollRef} className="flex-1 overflow-y-auto p-6 pt-4">
                {phase2Loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-slate-500">Initializing knowledge checklist module...</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                  {essayParts.map((part) => {
                    const partSegments = essayData.segments.filter((seg) =>
                      part.paragraph_ids.includes(seg.id)
                    );
                    const isHovered = hoveredPartId === part.id;
                    // 阶段二的颜色
                    const phase2Colors = ['green', 'red', 'blue', 'orange', 'purple', 'yellow', 'pink'];
                    const partColor = phase2Colors[(part.id - 1) % phase2Colors.length];
                    const colorClasses = {
                      green: 'bg-green-200',
                      red: 'bg-red-200',
                      blue: 'bg-blue-200',
                      orange: 'bg-orange-200',
                      purple: 'bg-purple-200',
                      yellow: 'bg-yellow-200',
                      pink: 'bg-pink-200',
                    };
                    
                    return (
                      <div
                        key={part.id}
                        data-part-id={part.id}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          isHovered
                            ? 'border-yellow-400 shadow-md'
                            : 'border-slate-200'
                        }`}
                        style={{
                          backgroundColor: isHovered
                            ? `${colorClasses[partColor] || 'bg-yellow-50'}`
                            : `${colorClasses[partColor] || 'bg-slate-50'}80`,
                        }}
                        onMouseEnter={() => setHoveredPartId(part.id)}
                        onMouseLeave={() => setHoveredPartId(null)}
                      >
                        <div className="text-sm font-semibold text-slate-700 mb-2">
                          {part.name}
                        </div>
                        <div className="text-xs text-slate-500 mb-2">{part.description}</div>
                        <div className="text-gray-800 leading-relaxed text-sm">
                          {partSegments.map((seg, idx) => {
                            const isSegmentHovered = hoveredSegmentId === seg.id;
                            return (
                              <span
                                key={seg.id}
                                className={isSegmentHovered ? 'bg-yellow-300 px-1 rounded' : ''}
                              >
                                {seg.text}
                                {idx < partSegments.length - 1 && ' '}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Knowledge Checklist
                </h2>
                {!phase2Loading && (
                  <button
                    onClick={() => initializePhase2(true)}
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Refill
                  </button>
                )}
              </div>
              <div ref={feedbackScrollRef} className="flex-1 overflow-y-auto p-6 pt-4">
                {phase2Loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-slate-500">Loading...</div>
                  </div>
                ) : (
                <KnowledgeChecklistModule
                  checklistItems={globalChecklistItems}
                  essayParts={essayParts}
                  feedbacks={feedbackData}
                  feedbackMappings={feedbackMappings}
                  onFuseBlocks={handleFuseBlocks}
                  essayText={essayData.segments.map((s) => s.text).join('\n')}
                  onHoverFeedback={(feedbackId) => {
                    setHoveredFeedbackId(feedbackId);
                    if (feedbackId) {
                      const feedback = feedbackData.find((f) => f.id === feedbackId);
                      if (feedback && feedback.relatedSegments) {
                        setHoveredSegmentId(feedback.relatedSegments[0] || null);
                      }
                    } else {
                      setHoveredSegmentId(null);
                    }
                  }}
                  onHoverPart={(partId) => {
                    setHoveredPartId(partId);
                    if (partId) {
                      const part = essayParts.find((p) => p.id === partId);
                      if (part && part.paragraph_ids.length > 0) {
                        setHoveredSegmentId(part.paragraph_ids[0]);
                        // 悬浮左侧文章部分时，也要滚动到中间
                        setTimeout(() => {
                          const essayContainer = document.querySelector('.overflow-y-auto');
                          if (essayContainer) {
                            const partElement = essayContainer.querySelector(`[data-part-id="${partId}"]`);
                            if (partElement) {
                              const containerRect = essayContainer.getBoundingClientRect();
                              const elementRect = partElement.getBoundingClientRect();
                              const scrollTop = essayContainer.scrollTop;
                              const targetScrollTop = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                              
                              essayContainer.scrollTo({
                                top: targetScrollTop,
                                behavior: 'smooth',
                              });
                            }
                          }
                        }, 100);
                      }
                    } else {
                      setHoveredSegmentId(null);
                    }
                  }}
                  onEditChecklistItem={handleEditChecklistItem}
                  onDeleteChecklistItem={handleDeleteChecklistItem}
                  hoveredPartId={hoveredPartId}
                  onRefill={() => initializePhase2(true)}
                  onScrollToPart={(partId) => {
                    // 滚动到对应的文章部分
                    setHoveredPartId(partId);
                    if (partId) {
                      const part = essayParts.find((p) => p.id === partId);
                      if (part && part.paragraph_ids.length > 0) {
                        setHoveredSegmentId(part.paragraph_ids[0]);
                        // 延迟一下确保DOM已更新，然后滚动
                        setTimeout(() => {
                          const essayContainer = document.querySelector('.overflow-y-auto');
                          if (essayContainer) {
                            const partElement = essayContainer.querySelector(`[data-part-id="${partId}"]`);
                            if (partElement) {
                              const containerRect = essayContainer.getBoundingClientRect();
                              const elementRect = partElement.getBoundingClientRect();
                              const scrollTop = essayContainer.scrollTop;
                              const targetScrollTop = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                              
                              essayContainer.scrollTo({
                                top: targetScrollTop,
                                behavior: 'smooth',
                              });
                            }
                          }
                        }, 100);
                      }
                    }
                  }}
                />
                )}
              </div>
            </div>
          </div>
        ) : phase === 'phase3' ? (
          // 阶段三：左边知识清单列表，右边图片占位框
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
            {/* 左边：知识清单列表 */}
            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Knowledge Checklist
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto p-6 pt-4">
                {globalChecklistItems.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-slate-500">No knowledge checklist items yet. Please complete Phase 2 first.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {globalChecklistItems.map((item) => {
                      const isActive = selectedChecklistId === item.id;
                      const { hasContent } = getContentForChecklistItem(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => setSelectedChecklistId(item.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-colors flex items-start gap-3 ${
                            isActive
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                          } ${!hasContent ? 'opacity-60' : ''}`}
                        >
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                            <span className="text-sm font-semibold text-indigo-700">{item.name}</span>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-slate-700 leading-relaxed">{item.description}</p>
                            {!hasContent && (
                              <p className="mt-1 text-xs text-slate-400">
                                No feedback blocks linked in Phase 2 yet.
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 右边：图片占位框 / 生成结果 */}
            <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between p-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">
                  Generated Comic
                </h2>
                <div>
                  {/** 生成/重新生成按钮：仅在当前知识点且实际在生成时才显示 Generating */}
                  {/** 注意：必须避免 null === null 导致误判 */}
                  <button
                    type="button"
                    onClick={handleGenerateComic}
                    disabled={
                      !selectedChecklistId ||
                      (generatingImageFor !== null &&
                        generatingImageFor === selectedChecklistId) ||
                      !selectedChecklistHasContent
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors ${
                      !selectedChecklistId ||
                      (generatingImageFor !== null &&
                        generatingImageFor === selectedChecklistId) ||
                      !selectedChecklistHasContent
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }`}
                  >
                    {generatingImageFor !== null &&
                    generatingImageFor === selectedChecklistId
                      ? 'Generating...'
                      : selectedChecklistId && currentComicImages[selectedChecklistId]
                      ? 'Regenerate'
                      : 'Generate'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 pt-4">
                {selectedChecklistId && currentComicImages[selectedChecklistId] ? (
                  <div className="w-full h-full min-h-[400px] rounded-lg bg-slate-50 flex items-center justify-center">
                    <img
                      src={`data:image/png;base64,${currentComicImages[selectedChecklistId]}`}
                      alt="Generated comic"
                      className="max-h-[600px] w-full object-contain rounded-lg shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setEnlargedImage(currentComicImages[selectedChecklistId])}
                    />
                  </div>
                ) : (
                  <div className="w-full h-full min-h-[400px] border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 flex items-center justify-center">
                    <div className="text-center">
                      <svg
                        className="mx-auto h-12 w-12 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="mt-4 text-sm text-slate-500">Image placeholder</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Select a knowledge item on the left and click Generate to create a comic.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      
      {/* 图片放大模态框 */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center">
            <img
              src={`data:image/png;base64,${enlargedImage}`}
              alt="Enlarged comic"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-2"
              aria-label="Close"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
