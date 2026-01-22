import { fetchFromOpenAi, fetchFromOpenAiImage } from "./fetchFromOpenAi";

// base system prompt for all calls in this file
const systemPrompt = () => {
  return `
    You are an expert writing instructor.
    You carefully read student essays and rubric-style feedback and help improve and analyze them.
  `;
};

// --------- Analyze all works to identify those with low-info negative feedbacks ----------

const analyzeAllWorksForLowInfoNegativePrompt = `
You are an expert writing instructor analyzing student works and their feedback.

Your task has TWO parts:
1. FILTERING: Identify which works have BOTH at least one low-info feedback AND at least one negative feedback
2. MARKING: For ALL works (not just filtered ones), mark ALL feedbacks that are low-info or negative

A feedback is considered LOW INFORMATION if it:
- Is very short (less than 40 characters) or generic
- Contains only generic praise words without specifics (e.g., "Good job!", "Nice!", "Well done!")
- Lacks specific references to concepts, examples, arguments, or writing techniques
- Could apply to any generic essay

A feedback is considered NEGATIVE if it:
- Contains negative words or phrases (e.g., "not", "bad", "poor", "lacks", "missing", "fails", "didn't", "doesn't", "inadequate", "insufficient")
- Indicates something the student did not do well or is missing
- Uses critical or negative language about the student's work
- Suggests areas for improvement in a negative way

FILTERING RULES (for work_ids):
- Only include a work id in work_ids if it has AT LEAST ONE feedback that is low-info AND AT LEAST ONE feedback that is negative
- The low-info feedback and negative feedback can be the same feedback (if a feedback is both low-info and negative) or different feedbacks
- A work that only has low-info feedbacks (but no negative feedbacks) should NOT be included in work_ids
- A work that only has negative feedbacks (but no low-info feedbacks) should NOT be included in work_ids

MARKING RULES (for work_details):
- You MUST analyze and mark feedbacks for ALL works in the input, regardless of whether they pass the filter
- For EACH work in the input, create an entry in work_details with ALL feedbacks marked appropriately
- Mark ALL feedbacks that are low-info in low_info_feedback_ids (can be empty array if none)
- Mark ALL feedbacks that are negative in negative_feedback_ids (can be empty array if none)
- A feedback can be both low-info and negative (appear in both arrays)

Input JSON format:
{
  "works": [
    {
      "id": 0,  // work index/id
      "feedbacks": [
        {
          "id": 1,
          "title": "section title such as 'CONCISENESS: Exceeds (10 pts)'",
          "text": "the feedback text"
        }
      ]
    }
  ]
}

Output JSON format:
{
  "work_ids": [0, 2, 5],  // array of work ids that have at least one low-info feedback AND at least one negative feedback (FILTERED)
  "work_details": [
    {
      "work_id": 0,
      "low_info_feedback_ids": [1, 3],  // ALL feedback IDs that are low information (for this work)
      "negative_feedback_ids": [2, 3]   // ALL feedback IDs that are negative (for this work, can overlap)
    },
    {
      "work_id": 1,
      "low_info_feedback_ids": [4],     // This work may NOT be in work_ids, but still needs marking
      "negative_feedback_ids": []        // Empty if no negative feedbacks
    },
    {
      "work_id": 2,
      "low_info_feedback_ids": [5],
      "negative_feedback_ids": [5, 7]
    }
  ]
}

CRITICAL REQUIREMENTS:
- work_ids: Only include works that have BOTH low-info AND negative feedbacks (filtering)
- work_details: MUST include ALL works from the input, with ALL their feedbacks marked (marking)
- Be accurate in your classification - only mark as negative if the feedback clearly contains negative language
- Only mark as low-info if the feedback is truly generic or lacks specific details
- The work_details array must have exactly one entry for each work in the input works array
- If no works match the filter criteria, work_ids should be an empty array [], but work_details should still contain all works
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function analyzeAllWorksForLowInfoNegative(works) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: analyzeAllWorksForLowInfoNegativePrompt },
    {
      role: "user",
      content: JSON.stringify({
        works: works.map((work) => ({
          id: work.id,
          feedbacks: work.feedbacks.map((f) => ({
            id: f.id,
            title: f.title || "",
            text: f.text || "",
          })),
        })),
      }),
    },
  ];

  try {
    // 筛选功能可能需要分析多篇文章，设置更长的超时时间（15分钟）
    const TIMEOUT_FOR_FILTER = 15 * 60 * 1000; // 15 minutes
    const openAiResponse = await fetchFromOpenAi(
      {
        model: "gpt-5.2",
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
        temperature: 0.3,
        messages: prompt,
      },
      TIMEOUT_FOR_FILTER
    );

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("analyzeAllWorksForLowInfoNegative error", e);
    throw e;
  }
}

// --------- Filter essays by user-defined criteria using LLM ----------

const filterEssaysByCriteriaPrompt = `
You are an expert writing instructor analyzing student essays.

Your task is to analyze essays and their feedbacks based on user-defined criteria, and identify which essays match the criteria.

The user will provide:
1. A filter criteria (description of what they want to find)
2. A list of essays with their feedbacks

You need to analyze each essay and determine if it matches the user's criteria. Consider:
- The essay content and structure
- The feedback provided for the essay
- How well the essay demonstrates the characteristics described in the filter criteria

Input JSON format:
{
  "filter_criteria": "user's description of what they want to filter",
  "works": [
    {
      "id": 0,
      "essay": "full essay text",
      "feedbacks": [
        {
          "id": 1,
          "title": "section title",
          "text": "feedback text"
        }
      ]
    }
  ]
}

Output JSON format:
{
  "work_ids": [0, 2, 5],  // array of work ids that match the filter criteria
  "analysis_summary": "brief explanation of what was analyzed and how the filter was applied"
}

CRITICAL REQUIREMENTS:
- Only include work ids that clearly match the user's filter criteria
- Be accurate and conservative - only include works when you are confident they match
- The work_ids array should contain the indices of works that match the criteria
- If no works match, return an empty array []
- Make sure the JSON is valid and follows this schema exactly.
`;

// --------- Filter feedbacks by criteria (with optional knowledge checklist context) ----------

const filterFeedbacksByCriteriaPrompt = `
You are an expert writing instructor analyzing feedback comments.

Your task is to filter feedbacks based on user-provided criteria.

Input JSON format:
{
  "filter_criteria": "user's search criteria or description",
  "feedbacks": [
    {
      "work_index": 0,  // which essay this feedback belongs to
      "feedback_id": 1,  // feedback id within that essay
      "title": "feedback title (may be empty)",
      "text": "feedback content text",
      "checklist_items": [1, 2]  // OPTIONAL: ids of knowledge checklist items this feedback satisfies
    },
    ...
  ],
  "knowledge_checklist": [
    {
      "id": 1,
      "name": "C1",
      "description": "Specific knowledge point description"
    }
  ]
}

Output JSON format:
{
  "matched_feedbacks": [
    {
      "work_index": 0,
      "feedback_id": 1
    },
    ...
  ]
}

Rules:
- Return only feedbacks that match the filter criteria
- A feedback matches if:
  - Its title OR text contains relevant information related to the criteria, OR
  - The criteria clearly refers to one or more knowledge checklist items, and this feedback's checklist_items includes ALL of those items.
- The criteria may refer to checklist items by:
  - Their ids (e.g., "C1", "C2")
  - Their descriptions (semantically similar phrasing)
  - Natural language that obviously matches a checklist description
- When the criteria is about "feedbacks that satisfy checklist item(s)", you MUST:
  - First infer which checklist ids the user means, using knowledge_checklist.
  - Then select only feedbacks whose checklist_items array contains ALL of those inferred ids.
- Be flexible in matching text - consider synonyms, related concepts, and different phrasings.
- Return an empty array if no feedbacks match
- The work_index and feedback_id must match exactly with the input

Make sure the JSON is valid and follows this schema exactly.
`;

export async function filterFeedbacksByCriteria(filterCriteria, feedbacks, checklistItems = []) {
  if (!filterCriteria || filterCriteria.trim().length === 0) {
    return { matched_feedbacks: [] };
  }

  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: filterFeedbacksByCriteriaPrompt },
    {
      role: "user",
      content: JSON.stringify({
        filter_criteria: filterCriteria,
        feedbacks: feedbacks.map(({ workIndex, feedbackId, title, text, checklist_items }) => ({
          work_index: workIndex,
          feedback_id: feedbackId,
          title: title || "",
          text: text || "",
          checklist_items: Array.isArray(checklist_items) ? checklist_items : [],
        })),
        knowledge_checklist: checklistItems.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || "",
        })),
      }),
    },
  ];

  try {
    const TIMEOUT_FOR_FILTER = 5 * 60 * 1000; // 5 minutes
    const openAiResponse = await fetchFromOpenAi(
      {
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
        temperature: 0.3,
        messages: prompt,
      },
      TIMEOUT_FOR_FILTER
    );

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("filterFeedbacksByCriteria error", e);
    throw e;
  }
}

export async function filterEssaysByCriteria(filterCriteria, works) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: filterEssaysByCriteriaPrompt },
    {
      role: "user",
      content: JSON.stringify({
        filter_criteria: filterCriteria,
        works: works.map((work, idx) => ({
          id: idx,
          essay: work.essay || "",
          feedbacks: (work.feedbacks || "").split("\n\n").map((f, fidx) => {
            const lines = f.split("\n");
            const firstLine = lines[0] || "";
            const isTitleLine = firstLine.includes(":") || /^[A-Z\s&]+$/.test(firstLine) || /\(\d+\s*pts?\)/i.test(firstLine);
            return {
              id: fidx + 1,
              title: isTitleLine ? firstLine : "",
              text: isTitleLine ? lines.slice(1).join("\n") : f,
            };
          }).filter(f => f.text.trim().length > 0),
        })),
      }),
    },
  ];

  try {
    const TIMEOUT_FOR_FILTER = 15 * 60 * 1000; // 15 minutes
    const openAiResponse = await fetchFromOpenAi(
      {
        model: "gpt-5.2",
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
        temperature: 0.3,
        messages: prompt,
      },
      TIMEOUT_FOR_FILTER
    );

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("filterEssaysByCriteria error", e);
    throw e;
  }
}

// --------- Enrich feedback for essay comments ----------

const enrichFeedbackPrompt = `
You are an expert writing instructor who gives specific, constructive feedback on student essays.
Your task is to take an existing feedback label and (optionally) a short comment,
read the student's essay, and generate richer, more helpful feedback options.

STRICT REQUIREMENTS ABOUT ALIGNMENT WITH THE ESSAY:
1. Every feedback option MUST be clearly and explicitly grounded in the essay text.
   - It should refer to specific ideas, arguments, examples, or writing techniques that actually appear in the essay.
   - A knowledgeable reader should be able to point to concrete sentences or paragraphs that justify the feedback.
2. Do NOT invent feedback that could apply to any generic essay. If you cannot find clear support in the essay, you MUST NOT generate that option.
3. If you cannot generate ANY option that is well-grounded in specific parts of the essay, return an empty options array [].
4. Use a clear, supportive tone suitable for a student.
5. Be specific: briefly mention what the student did well or what needs improvement, and hint at WHERE in the essay this happens (e.g., \"in the paragraph where you describe ...\").
6. Each option should be 1–3 sentences, not longer than 80 words.

Input JSON format:
{
  "essay": "full essay text",
  "feedback_title": "section title such as 'CONCISENESS: Exceeds (10 pts)'",
  "current_feedback": "the current short feedback text (may be empty)"
}

Output JSON format:
{
  "main_feedback": "",          // the best single feedback sentence to display
  "options": ["", "", ...]      // 3–5 alternative feedback sentences (including main_feedback as first element)
}

If you cannot produce any well-grounded feedback, set:
- "main_feedback" to an empty string ""
- "options" to an empty array []

Make sure the JSON is valid and follows this schema exactly.
`;

export async function enrichFeedbackForEssay(
  essay,
  feedbackTitle,
  currentFeedback
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: enrichFeedbackPrompt },
    {
      role: "user",
      content: JSON.stringify({
        essay,
        feedback_title: feedbackTitle,
        current_feedback: currentFeedback,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
      temperature: 0.4,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("enrichFeedbackForEssay error", e);
    throw e;
  }
}

// A variant specialized for this app: enrich feedback using rubric title, current text,
// and model works only. It DOES NOT need to know specific paragraphs of the student's essay,
// and the generated options SHOULD NOT reference paragraph numbers or locations like
// "in paragraph 2" or "in the second paragraph".
const enrichFeedbackWithMappingPrompt = `
You are an expert writing instructor who gives specific, constructive feedback on student essays.
Your task is to take an existing feedback label and (optionally) a short comment,
and generate richer, more helpful feedback OPTIONS.

You will be provided with model essays (exemplary works) as reference. Use these model essays to:
- Understand what high-quality work looks like in this context
- Identify what the student's essay might be missing compared to the models
- Generate feedback that helps the student improve toward the model standard
- Ground your feedback in the rubric label and current short comment, using model essays only as examples of what "good" looks like.

SPECIAL HANDLING FOR LOW-INFORMATION NEGATIVE FEEDBACK:
First, you MUST determine if the feedback is negative. A feedback is considered negative if it:
- Contains negative words or phrases (e.g., "not", "bad", "poor", "lacks", "missing", "fails", "didn't", "doesn't", "inadequate", "insufficient")
- Indicates something the student did not do well or is missing
- Uses critical or negative language about the student's work

If the feedback is marked as "is_low_info" (low information content) AND you determine it is NEGATIVE, you MUST follow this special process:

1. FEEDBACK REVERSAL: First, identify what aspect or area ("where") the negative feedback is about, then reverse it into a positive question.
   - Example: If feedback says "You did not do well in A" or "Bad job in A", reverse it to "What did you do well in A?" or "Where did you do well in A?"
   - Example: If feedback says "Lacks clarity" or "Not clear", reverse it to "Where could clarity be improved?" or "What makes writing clear?"
   - The reversal should focus on finding the specific area or aspect (the "where") mentioned in the negative feedback
   - Extract the key concept or area from the negative feedback and frame it as a positive inquiry about what "good" looks like in that area

2. SEARCH MODEL WORK: Use the reversed positive question to search through the model essays.
   - Look for examples in the model essays that demonstrate what "good" looks like in that specific area (the "where" from step 1)
   - Identify specific instances, techniques, or approaches in the model essays that address the reversed question
   - Find concrete examples of how the model essays handle the aspect mentioned in the original negative feedback
   - Extract specific sentences or passages from model essays that exemplify good practice in that area

3. GENERATE ENRICHED OPTIONS: Based on what you found in the model essays, generate enriched feedback options that:
   - Reference specific examples or techniques from the model essays that demonstrate good practice
   - Connect to the student's essay by identifying where similar concepts could be applied or where they are missing
   - Provide constructive guidance on what the student could do better, using the model essays as reference
   - Each option should help the student understand what "good" looks like in that specific area, based on model essay examples

CRITICAL: For low-information negative feedback, the reversal and model work search process is MANDATORY. This helps provide more accurate and constructive feedback by first identifying what "good" looks like, then connecting it to the student's work in a general way (without pointing to specific paragraphs).

For POSITIVE feedback or NON-LOW-INFO feedback, follow the normal process below.

STRICT REQUIREMENTS FOR THE FEEDBACK OPTIONS:
1. Each feedback option MUST be specific and constructive.
   - Refer to concrete ideas, arguments, concepts, or writing techniques that are implied by the rubric label and the current short comment.
   - You may use typical examples for this kind of assignment, but avoid referring to specific paragraph numbers or locations in the student's essay.
2. Do NOT invent feedback that is completely unrelated to the rubric label.
3. If you cannot generate ANY reasonable option, return an empty options array [].
4. Use a clear, supportive tone suitable for a student.
5. Be specific: briefly mention what the student did well or what needs improvement, but DO NOT mention paragraph numbers or locations like "in paragraph 2", "in the second paragraph", "earlier in your essay", etc.
6. Each option should be 1–3 sentences, not longer than 80 words.
7. When model essays are provided, use them as reference to identify what "good" looks like in this area, but describe this in general terms (e.g., "strong examples", "clear explanation") instead of pointing to specific parts of the student's essay.

Input JSON format:
{
  "feedback_title": "section title such as 'CONCISENESS: Exceeds (10 pts)'",
  "current_feedback": "the current short feedback text (may be empty)",
  "is_low_info": false,  // boolean: true if this feedback has low information content
  "model_essays": [
    { "essay": "full text of model essay 1" },
    { "essay": "full text of model essay 2" }
  ]
}

Output JSON format:
{
  "options": [
    {
      "text": ""  // the feedback sentence(s), WITHOUT mentioning paragraph numbers or locations
    }
  ]
}

Rules:
- Every option in the "options" array must have a non-empty "text" field.
- If you cannot produce any such option, set "options" to an empty array [].
- Make sure the JSON is valid and follows this schema exactly.
- When model essays are provided, use them to inform your feedback, but always ground feedback in the student's actual text.
`;

export async function enrichFeedbackForEssayWithMapping(
  feedbackTitle,
  currentFeedback,
  modelEssays = [],
  isLowInfo = false
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: enrichFeedbackWithMappingPrompt },
    {
      role: "user",
      content: JSON.stringify({
        feedback_title: feedbackTitle,
        current_feedback: currentFeedback,
        is_low_info: isLowInfo,
        model_essays: modelEssays,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
      temperature: 0.4,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("enrichFeedbackForEssayWithMapping error", e);
    throw e;
  }
}

// --------- Map feedback items to essay paragraphs ----------

const mapFeedbackPrompt = `
You are an expert writing instructor and grader.
Your task is to precisely match rubric-style feedback items to specific paragraphs in a student's essay.

CRITICAL REQUIREMENTS FOR PRECISION AND ACCURACY:
1. SINGLE PARAGRAPH MAPPING: Each feedback must map to EXACTLY ONE paragraph (the most relevant one).
   - Even if the feedback could theoretically relate to multiple paragraphs, you must choose ONLY THE MOST RELEVANT paragraph
   - Return an array with only ONE paragraph ID, not multiple
   - If you cannot identify a single, clear, most relevant paragraph, return an empty array []

2. COMPREHENSIVE ANCHORING TEXT IDENTIFICATION: For each feedback item, you must identify ALL relevant complete sentences (anchoring text) that address the feedback concept.
   - The anchoring text should be a comprehensive list of ALL sentences that attempt to address the idea (for statement-related rubric items) or EVERY instance where the terms are used (for correct usage or understanding-related rubric items)
   - For each feedback item, the anchoring text should contain at least one complete sentence
   - Please be comprehensive and do NOT miss any relevant sentences
   - The relevance does not need to be direct, but it should be relevant to the concept in the feedback item
   - Each element in the anchoring text list should contain exactly ONE complete sentence
   - If a sentence contains in-text citations, include the citations in the anchoring text
   - Each sentence must START with a capital letter and END with a punctuation mark (. ! ?)
   - Do NOT include partial sentences, sentence fragments, or sentences that don't end with proper punctuation

3. COMPLETE SENTENCE REQUIREMENT WITH PUNCTUATION: Only create a mapping if the feedback text explicitly references, critiques, or praises content that corresponds to AT LEAST ONE COMPLETE, FULL SENTENCE in that paragraph.
   - You must be able to identify at least one entire sentence that STARTS with a capital letter and ENDS with a punctuation mark (. ! ?)
   - The sentence must be complete and end with proper punctuation - do NOT include sentences that are cut off or incomplete
   - Do NOT create mappings based on partial sentences, sentence fragments, or sentences that don't end with punctuation
   - The complete sentence must contain the specific content, example, argument, or writing technique that the feedback is addressing
   - If you can only find partial matches, sentence fragments, or sentences without proper ending punctuation, do NOT create a mapping

4. STRICT EVIDENCE REQUIREMENT: Before linking a feedback to a paragraph, you must:
   - Comprehensively identify ALL complete sentences in that paragraph that relate to the feedback (the anchoring text)
   - Verify that each identified sentence ENDS with proper punctuation (. ! ?)
   - Verify that each identified sentence contains specific evidence (concepts, examples, arguments, writing techniques) mentioned in the feedback
   - Ensure the connection is explicit and unambiguous, not inferred or assumed
   - The identified sentences must be the most relevant matches for the feedback

5. Do NOT link feedback to paragraphs if:
   - The feedback is too general or vague (e.g., "Good job!", "Nice job!", "Well done!", "Excellent work!", "Great work!")
   - The feedback consists only of generic praise words without specifics (e.g., "Good.", "Nice.", "Well.", "Great.", "Excellent.", "Fine.", "Okay.")
   - The feedback only mentions the rubric category name without concrete details
   - The feedback could apply to the entire essay rather than specific paragraphs
   - You cannot identify at least one complete sentence in the paragraph that directly relates to the feedback
   - The paragraph only contains partial matches or sentence fragments related to the feedback
   - The feedback lacks specific references to concepts, examples, arguments, or writing techniques
   - The connection is vague, indirect, or requires significant inference

6. ACCURACY STANDARDS:
   - Be extremely conservative: only create mappings when you are highly confident
   - When in doubt, return an empty array rather than guessing
   - Quality over quantity: it is better to miss a connection than to create an incorrect one
   - Each mapping must be supported by clear, explicit textual evidence in the form of complete sentences

7. Generic praise words (good, nice, well, great, excellent, fine, okay) alone or in simple phrases like "Good job" are NOT sufficient to create a mapping. The feedback must contain specific, actionable information about the essay content that can be matched to complete sentences.

Matching criteria:
- Look for specific mentions: concepts, examples, arguments, writing style issues, or strengths mentioned in the feedback
- The feedback text must contain enough detail to identify which paragraph(s) it refers to
- You must be able to point to at least one complete sentence in each linked paragraph that directly supports the feedback
- If the feedback is just a category label (like "CONCISENESS: Exceeds (10 pts)") with no additional text, do NOT create mappings unless the feedback text field contains specific references that can be matched to complete sentences

Input JSON format:
{
  "paragraphs": [
    { "id": 1, "text": "..." },
    { "id": 2, "text": "..." }
  ],
  "feedback_items": [
    { "id": 1, "title": "...", "text": "..." },
    { "id": 2, "title": "...", "text": "..." }
  ]
}

Output JSON format:
{
  "mappings": [
    {
      "feedback_id": 1,
      "related_paragraph_ids": [1],  // MUST contain EXACTLY ONE paragraph ID, or empty array [] if no precise match found
      "reason": "brief explanation identifying ALL relevant complete sentences (anchoring text) that link this feedback to this paragraph. Must quote ALL exact complete sentences (each ending with punctuation . ! ?) that are relevant to the feedback concept. Be comprehensive and do not miss any relevant sentences."
    }
  ]
}

IMPORTANT: 
- Every feedback_id from the input must appear exactly once in the mappings array
- related_paragraph_ids MUST contain EXACTLY ONE paragraph ID (the most relevant one), or an empty array [] if no match is found
- DO NOT return multiple paragraph IDs - always choose the single most relevant paragraph
- If you cannot find at least one complete sentence (ending with punctuation) in any paragraph that directly supports the feedback, set related_paragraph_ids to an empty array []
- Be comprehensive in identifying anchoring text: identify ALL relevant complete sentences, not just one
- The "reason" field must quote ALL exact complete sentences (anchoring text) that provide evidence, and each sentence MUST end with proper punctuation (. ! ?)
- Each quoted sentence in the reason field should be a separate, complete sentence ending with punctuation
- Do not miss any relevant sentences - be thorough in your identification of anchoring text
- If sentences contain in-text citations, include them in the quoted anchoring text
`;

export async function mapFeedbackToEssayParagraphs(paragraphs, feedbackItems) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: mapFeedbackPrompt },
    {
      role: "user",
      content: JSON.stringify({
        paragraphs,
        feedback_items: feedbackItems,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
      temperature: 0,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("mapFeedbackToEssayParagraphs error", e);
    throw e;
  }
}

// --------- Phase 2: Segment essay into logical parts (参考modelWorks + 可选统一模板) ----------

const segmentEssayPrompt = `
You are an expert writing instructor analyzing student essays.
Your task is to segment a student essay into logical parts based on the essay's structure and content.

You will be provided with model essays (exemplary works) as reference to understand the expected structure.
Use these model essays to:
- Understand how essays of this type are typically structured
- Identify logical divisions (e.g., introduction, body paragraphs discussing different topics, conclusion)
- Segment the student essay in a similar way

CRITICAL REQUIREMENTS:
1. Segment the essay into logical parts based on content and structure (e.g., "Part 1: Introduction and definition", "Part 2: Discussion of externalities", "Part 3: Analysis of case study", etc.)
2. Each segment should represent a distinct logical unit of the essay
3. Reference the model essays to understand the expected structure
4. Each segment should include the paragraph IDs that belong to it

You may ALSO be provided with a TEMPLATE of segments (template_segments) that defines the target structure for this assignment.
When a template is provided:
- You MUST keep the NUMBER of segments exactly the same as in template_segments
- You MUST keep the ORDER of segments the same as in template_segments
- You MUST reuse the segment names from template_segments
- Your task is to map the student's paragraphs into these fixed segments as reasonably as possible

Input JSON format:
{
  "paragraphs": [
    { "id": 1, "text": "..." },
    { "id": 2, "text": "..." }
  ],
  "model_essays": [
    { "essay": "full text of model essay 1" },
    { "essay": "full text of model essay 2" }
  ],
  "template_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition"
    }
  ]
}

Output JSON format:
{
  "segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition",
      "paragraph_ids": [1, 2]
    },
    {
      "id": 2,
      "name": "Part 2: Discussion of Externalities",
      "paragraph_ids": [3, 4]
    }
  ]
}

Rules:
- Every paragraph ID must appear in exactly one segment
- Segments should be logically meaningful (not just arbitrary splits)
- Use model essays as reference for structure, but segment based on the student essay's actual content
- If template_segments is provided:
  - The number of output segments MUST equal template_segments.length
  - The order of output segments MUST match the order of template_segments
  - The id and name of each output segment SHOULD match the corresponding template segment
  - All student paragraphs must still be assigned to some segment via paragraph_ids
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function segmentEssayIntoParts(paragraphs, modelEssays = [], templateSegments = null) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: segmentEssayPrompt },
    {
      role: "user",
      content: JSON.stringify({
        paragraphs,
        model_essays: modelEssays,
        template_segments: templateSegments,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
      temperature: 0.3,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("segmentEssayIntoParts error", e);
    throw e;
  }
}

// --------- Generate a unified essay parts TEMPLATE from model works ----------

// 只根据多篇范文，生成一套统一的分段模板（不绑定具体段落）
const generateEssayPartsTemplatePrompt = `
You are an expert writing instructor analyzing multiple exemplary model essays.

Your task is to design a UNIFIED segmentation template for this assignment type.

GOAL:
- Read ALL provided model essays.
- Infer a reasonable, repeatable structure for essays of this assignment type.
- Return a list of logical parts (segments) that can be applied to ANY student's essay.

Each segment should:
- Represent a distinct logical unit (e.g., "Introduction & definition", "Explain main concept", "Analyze case study", "Conclusion & policy suggestions").
- Have a short, clear name that can be shown in UI (e.g., "Part 1: Introduction & Market Failure Definition").
- Optionally include a 1–2 sentence description explaining what should appear in this part.

IMPORTANT:
- You are NOT mapping to specific paragraphs here.
- You are ONLY designing a generic template that downstream tools can reuse.

Input JSON:
{
  "model_essays": [
    { "essay": "full text of model essay 1" },
    { "essay": "full text of model essay 2" }
  ]
}

Output JSON:
{
  "template_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction & Market Failure Definition",
      "description": "Define market failure and briefly introduce the assignment context."
    },
    {
      "id": 2,
      "name": "Part 2: Types of Market Failure",
      "description": "List and briefly explain the main types of market failure relevant to the assignment."
    }
  ]
}

Rules:
- 3–8 segments are usually enough; do NOT create an excessively long list.
- Ids MUST start from 1 and increase by 1 in order.
- Names must be concise but informative.
- Descriptions are optional but recommended; keep them short (<= 2 sentences).
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function generateEssayPartsTemplate(modelEssays = []) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: generateEssayPartsTemplatePrompt },
    {
      role: "user",
      content: JSON.stringify({
        model_essays: modelEssays,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 4096,
      temperature: 0.3,
      messages: prompt,
    }, 60000 * 3); // 10 minutes

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("generateEssayPartsTemplate error", e);
    throw e;
  }
}

// --------- Phase 2: Map feedbacks to knowledge checklist items ----------

const mapFeedbackToChecklistPrompt = `
You are an expert writing instructor building a knowledge checklist based on student essays and feedback.

Your task is to map feedback sentences to knowledge checklist items and essay parts.
The knowledge checklist items represent different aspects of knowledge or skills that should be demonstrated in the essay.

CRITICAL REQUIREMENTS:
1. Each feedback sentence should be mapped to one or more knowledge checklist items based on the checklist item descriptions
2. Each feedback sentence should also be mapped to one or more essay parts (segments) based on which paragraphs the feedback relates to
3. To determine essay_part_ids: check which essay parts contain the paragraphs mentioned in feedback's related_paragraph_ids
4. The mapping should indicate which knowledge checklist items are satisfied by which feedback sentences
5. The colored blocks in the grid represent feedback sentences (F1, F2, etc.)
6. The distribution of colored blocks indicates which essay part(s) each feedback sentence corresponds to

Input JSON format:
{
  "essay_parts": [
    {
      "id": 1,
      "name": "Part 1: Introduction",
      "description": "...",
      "paragraph_ids": [1, 2]
    }
  ],
  "feedbacks": [
    {
      "id": 1,
      "text": "feedback sentence 1",
      "related_paragraph_ids": [1, 2]  // which paragraphs this feedback relates to
    }
  ],
  "knowledge_checklist": [
    {
      "id": 1,
      "name": "C1",
      "description": "Specific knowledge point description"
    }
  ]
}

Output JSON format:
{
  "mappings": [
    {
      "feedback_id": 1,
      "checklist_items": [1, 3],  // which knowledge checklist items (by id) this feedback satisfies
      "essay_part_ids": [1]       // which essay parts contain the paragraphs in related_paragraph_ids
    }
  ]
}

Rules:
- Every feedback_id must appear exactly once in the mappings array
- checklist_items should be an array of checklist item IDs that match the feedback content
- essay_part_ids should be determined by finding which essay parts contain the paragraphs in feedback's related_paragraph_ids
- If a feedback doesn't clearly map to any checklist item, set checklist_items to an empty array []
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function mapFeedbackToKnowledgeChecklist(
  essayParts,
  feedbacks,
  checklistItems = []
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: mapFeedbackToChecklistPrompt },
    {
      role: "user",
      content: JSON.stringify({
        essay_parts: essayParts,
        feedbacks: feedbacks.map((f) => ({
          id: f.id,
          text: f.text,
          related_paragraph_ids: f.relatedSegments || [],
        })),
        knowledge_checklist: checklistItems,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
      temperature: 0.3,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("mapFeedbackToKnowledgeChecklist error", e);
    throw e;
  }
}

// --------- Phase 2: Generate knowledge checklist items from rubric ----------

const generateChecklistItemsPrompt = `
You are an expert writing instructor creating a knowledge checklist based on a scoring rubric.

Your task is to break down a scoring rubric into specific knowledge checklist items (C1, C2, C3, etc.).
Each checklist item should represent a specific knowledge point or skill that students need to demonstrate.

Input JSON format:
{
  "rubric_text": "the full rubric text with feedback categories and descriptions"
}

Output JSON format:
{
  "checklist_items": [
    {
      "id": 1,
      "name": "C1",
      "description": "Specific knowledge point or skill description"
    },
    {
      "id": 2,
      "name": "C2",
      "description": "Specific knowledge point or skill description"
    }
  ]
}

Rules:
- Generate 4-8 checklist items based on the rubric
- Each item should be specific and measurable
- Use clear, concise descriptions
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function generateKnowledgeChecklistItems(rubricText) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: generateChecklistItemsPrompt },
    {
      role: "user",
      content: JSON.stringify({
        rubric_text: rubricText,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
      temperature: 0.3,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("generateKnowledgeChecklistItems error", e);
    throw e;
  }
}

// --------- Phase 2: Fuse two feedback blocks to generate new checklist item ----------

const fuseFeedbackBlocksPrompt = `
You are an expert writing instructor analyzing student essays and feedback.

Your task is to generate a new knowledge checklist item based on two selected feedback sentences and their corresponding essay parts.
This helps teachers discover what students haven't done well regarding the feedback and sentences corresponding to the selected blocks.

CRITICAL REQUIREMENTS:
1. Analyze the two feedback sentences and their corresponding essay parts
2. Identify a common knowledge gap or skill that both feedbacks point to
3. Generate a new knowledge checklist item that captures this gap
4. The new checklist item should help teachers understand what students need to improve

Input JSON format:
{
  "feedback1": {
    "id": 1,
    "text": "feedback sentence 1",
    "related_paragraph_ids": [1, 2]
  },
  "feedback2": {
    "id": 2,
    "text": "feedback sentence 2",
    "related_paragraph_ids": [3, 4]
  },
  "essay_parts": [
    {
      "id": 1,
      "name": "Part 1",
      "description": "...",
      "paragraph_ids": [1, 2]
    }
  ],
  "essay_text": "full essay text for context"
}

Output JSON format:
{
  "new_checklist_item": {
    "name": "C7",
    "description": "New knowledge checklist item description based on the fusion of the two feedback blocks"
  },
  "explanation": "Brief explanation of why these two feedbacks were fused and what knowledge gap they reveal"
}

Rules:
- The new checklist item should be meaningful and specific
- It should capture a knowledge gap or skill that both feedbacks point to
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function fuseFeedbackBlocks(
  feedback1,
  feedback2,
  essayParts,
  essayText
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: fuseFeedbackBlocksPrompt },
    {
      role: "user",
      content: JSON.stringify({
        feedback1: {
          id: feedback1.id,
          text: feedback1.text,
          related_paragraph_ids: feedback1.relatedSegments || [],
        },
        feedback2: {
          id: feedback2.id,
          text: feedback2.text,
          related_paragraph_ids: feedback2.relatedSegments || [],
        },
        essay_parts: essayParts,
        essay_text: essayText,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
      temperature: 0.4,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("fuseFeedbackBlocks error", e);
    throw e;
  }
}

// --------- Generate candidate checklist items from dragged evidence blocks ----------

const generateChecklistCandidatesFromEvidencePrompt = `
You are an expert writing instructor helping a teacher build a knowledge checklist.

The teacher has selected several EVIDENCE BLOCKS from:
- specific paragraphs of student essays, and/or
- specific feedback comments linked to those essays.

Your task:
1. Carefully read all evidence blocks and infer up to THREE potential knowledge checklist items (C-style items).
2. Each checklist item should describe a specific, reusable knowledge point or skill that could appear in many essays.
3. When possible, use the model essays (high-quality examples) to refine and clarify the wording of checklist items.
4. Avoid duplicating existing checklist items that are already provided.

Input JSON:
{
  "evidence_blocks": [
    {
      "id": "e1",
      "type": "essay" | "feedback",
      "label": "Essay-#1-C1",
      "text": "full text snippet from essay paragraph(s) or feedback comment"
    }
  ],
  "model_essays": [
    { "essay": "full text of model essay 1" }
  ],
  "existing_checklist": [
    {
      "id": 1,
      "name": "C1",
      "description": "Existing checklist description"
    }
  ]
}

Output JSON:
{
  "candidates": [
    {
      "id": "cand1",
      "description": "Concise checklist item description",
      "source_evidence_ids": ["e1", "e3"]
    }
  ]
}

Rules:
- Return at most 3 candidates. If there is not enough clear common structure, you may return 1–2.
- descriptions must be short, concrete, and assessment-friendly (like rubric bullets).
- Use source_evidence_ids to indicate which evidence blocks most strongly support each candidate.
- If the evidence is too weak or generic to form any solid checklist item, return an empty candidates array [].
- Do NOT invent totally new topics that are not grounded in the evidence or model essays.
`;

export async function generateChecklistCandidatesFromEvidence(
  evidenceBlocks,
  modelEssays = [],
  existingChecklist = []
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: generateChecklistCandidatesFromEvidencePrompt },
    {
      role: "user",
      content: JSON.stringify({
        evidence_blocks: evidenceBlocks.map((b) => ({
          id: b.id,
          type: b.type,
          label: b.label,
          text: b.text || "",
        })),
        model_essays: modelEssays,
        existing_checklist: existingChecklist.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || "",
        })),
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
      temperature: 0.3,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("generateChecklistCandidatesFromEvidence error", e);
    throw e;
  }
}

const imagePrompt = (list) => {
  return `
    You are an expert “educational comic storyboard” illustrator. Generate ONE single-page,the aspect ratio of the image is 1:1, full-color comic that teaches a knowledge point clearly through panels and speech bubbles, with a light, fun tone.
﻿
    GOAL
    - Style: clean, readable educational comic style; crisp lineart, flat colors, light shading, subtle halftone texture; high clarity for text.
    - Tone: friendly, encouraging, slightly humorous when appropriate, but NEVER at the cost of clarity or correctness.
    - Characters:
      - Character A (explainer): a small cute “robot tutor” (blue/white palette allowed) but 100% original design (no recognizable IP traits, no famous character lookalikes).
      - Character B (learner): a student wearing glasses; expressive face progression (confused → understanding).
    - Text: ALL text must be English. Keep it short,avoid long paragraphs.
﻿
    INPUT CONTENT (STRICT)
    I will provide a list CONTENT_LIST in teaching order. You MUST base ALL explanations, examples, and summaries ONLY on this list.
    - You may rephrase, simplify, organize, or slightly combine ideas from CONTENT_LIST.
    - You MUST NOT introduce new concepts, examples, formulas, or facts that are not clearly implied by CONTENT_LIST.
    - If some panel would require extra knowledge that is not present in CONTENT_LIST, keep the content simple and only use what is given.
﻿
    OUTPUT REQUIREMENTS
    - Output ONLY the comic page image itself (no extra explanation text outside the image).
    - Keep the page clean, moderate information density, and an obvious reading order (top-to-bottom, left-to-right).
    - The comic must feel like an original educational strip, not a copy of any existing comic or franchise.
    - All educational content in the comic must be directly grounded in CONTENT_LIST; do not hallucinate new topics.
    - The generated image should have a size of 1024x1024, with blank space around it, and no cropping is allowed

    NOW GENERATE
    CONTENT_LIST:
    ${list.join("\n")}
  `;
};

// --------- Combined Phase 1 & Phase 2: Segment essay and map feedbacks simultaneously ----------

const combinedPhase1AndPhase2Prompt = `
You are an expert writing instructor analyzing student essays and feedback.
Your task is to simultaneously:
1. Segment the essay into logical parts
2. Map feedback items to specific paragraphs
3. Map feedback items to knowledge checklist items and essay parts

This combined approach ensures consistency and accuracy across all mappings.

CRITICAL REQUIREMENTS:

PART 1: ESSAY SEGMENTATION
1. Segment the essay into logical parts based on content and structure (e.g., "Part 1: Introduction and definition", "Part 2: Discussion of externalities", "Part 3: Analysis of case study", etc.)
2. Each segment should represent a distinct logical unit of the essay
4. Each segment must include the paragraph IDs that belong to it
5. If template_segments is provided:
   - You MUST keep the NUMBER of segments exactly the same as in template_segments
   - You MUST keep the ORDER of segments the same as in template_segments
   - You MUST reuse the segment names from template_segments
   - Map the student's paragraphs into these fixed segments as reasonably as possible
6. Every paragraph ID must appear in exactly one segment

PART 2: FEEDBACK TO PARAGRAPH MAPPING
1. SINGLE PARAGRAPH MAPPING: Each feedback must map to EXACTLY ONE paragraph (the most relevant one)
   - Even if the feedback could theoretically relate to multiple paragraphs, choose ONLY THE MOST RELEVANT paragraph
   - Return an array with only ONE paragraph ID, or empty array [] if no match found
2. COMPLETE SENTENCE REQUIREMENT: Only create a mapping if the feedback text explicitly references content that corresponds to AT LEAST ONE COMPLETE, FULL SENTENCE in that paragraph
   - The sentence must START with a capital letter and END with a punctuation mark (. ! ?)
   - Do NOT create mappings based on partial sentences or sentence fragments
3. STRICT EVIDENCE REQUIREMENT: Before linking a feedback to a paragraph, you must:
   - Identify ALL complete sentences in that paragraph that relate to the feedback
   - Verify each sentence ENDS with proper punctuation
   - Ensure the connection is explicit and unambiguous
4. Do NOT link feedback to paragraphs if:
   - The feedback is too general or vague (e.g., "Good job!", "Nice!", "Well done!")
   - The feedback consists only of generic praise words without specifics
   - The feedback only mentions the rubric category name without concrete details
   - You cannot identify at least one complete sentence that directly relates to the feedback
5. Be extremely conservative: only create mappings when you are highly confident
   - When in doubt, return an empty array rather than guessing

PART 3: FEEDBACK TO KNOWLEDGE CHECKLIST AND ESSAY PARTS MAPPING
1. Map each feedback to one or more knowledge checklist items based on the checklist item descriptions
2. Map each feedback to one or more essay parts (segments) based on:
   - The paragraph(s) the feedback relates to (from Part 2)
   - Which essay parts contain those paragraphs (from Part 1)
3. To determine essay_part_ids: check which essay parts contain the paragraphs mentioned in the feedback's related_paragraph_ids
4. The mapping should indicate which knowledge checklist items are satisfied by which feedback sentences
5. If a feedback doesn't clearly map to any checklist item, set checklist_items to an empty array []

CONSISTENCY REQUIREMENTS:
- The related_paragraph_ids in feedback_mappings must match the paragraph_ids in essay_segments
- The essay_part_ids in feedback_mappings must be determined by finding which essay parts contain the paragraphs in related_paragraph_ids
- All mappings must be internally consistent: if a feedback maps to paragraph 3, and paragraph 3 is in Part 2, then the feedback's essay_part_ids must include Part 2

Input JSON format:
{
  "paragraphs": [
    { "id": 1, "text": "..." },
    { "id": 2, "text": "..." }
  ],
  "feedback_items": [
    { "id": 1, "title": "...", "text": "..." },
    { "id": 2, "title": "...", "text": "..." }
  ],
  "model_essays": [
    { "essay": "full text of model essay 1" },
    { "essay": "full text of model essay 2" }
  ],
  "template_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition",
      "description": "Brief description of what this part covers"
    }
  ],
  "knowledge_checklist": [
    {
      "id": 1,
      "name": "C1",
      "description": "Specific knowledge point description"
    }
  ]
}

Output JSON format:
{
  "essay_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition",
      "paragraph_ids": [1, 2]
    },
    {
      "id": 2,
      "name": "Part 2: Discussion of Externalities",
      "paragraph_ids": [3, 4]
    }
  ],
  "feedback_mappings": [
    {
      "feedback_id": 1,
      "related_paragraph_ids": [1],  // MUST contain EXACTLY ONE paragraph ID, or empty array [] if no match found
      "checklist_items": [1, 3],     // which knowledge checklist items (by id) this feedback satisfies
      "essay_part_ids": [1],         // which essay parts contain the paragraphs in related_paragraph_ids
      "reason": "brief explanation identifying ALL relevant complete sentences (anchoring text) that link this feedback to this paragraph. Must quote ALL exact complete sentences (each ending with punctuation . ! ?) that are relevant to the feedback concept."
    }
  ]
}

Rules:
- Every paragraph ID must appear in exactly one essay_segment
- Every feedback_id must appear exactly once in the feedback_mappings array
- related_paragraph_ids MUST contain EXACTLY ONE paragraph ID (the most relevant one), or an empty array [] if no match is found
- essay_part_ids should be determined by finding which essay parts contain the paragraphs in related_paragraph_ids
- checklist_items should be an array of checklist item IDs that match the feedback content
- If template_segments is provided, the essay_segments output must match its structure (number, order, names)
- All mappings must be internally consistent
- Make sure the JSON is valid and follows this schema exactly.
`;

export async function combinedPhase1AndPhase2(
  paragraphs,
  feedbackItems,
  modelEssays = [],
  templateSegments = null,
  checklistItems = []
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: combinedPhase1AndPhase2Prompt },
    {
      role: "user",
      content: JSON.stringify({
        paragraphs,
        feedback_items: feedbackItems,
        model_essays: modelEssays,
        template_segments: templateSegments,
        knowledge_checklist: checklistItems,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 4096,
      temperature: 0.2,
      messages: prompt,
    });

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("combinedPhase1AndPhase2 error", e);
    throw e;
  }
}

// --------- Combined Phase 1 & Phase 2 (BATCH): handle multiple works in one call ----------
// Redesigned to match app semantics:
// 1) Use template_segments (from model works) to segment each student essay.
// 2) For the essay matrix: decide which paragraphs satisfy each checklist item C1–Cn.
// 3) For the feedback matrix: decide, for EACH feedback, which checklist items it talks about,
//    and which essay paragraph(s)/segment(s) that feedback is referring to.
const combinedPhase1AndPhase2BatchPrompt = `
You are an expert writing instructor analyzing MULTIPLE student essays and their feedback in one batch.
For EACH work (essay + its feedback items) you must independently:
1. Segment the essay into logical parts using a FIXED template provided by the caller.
2. Analyze the essay content against a global knowledge checklist (C1–Cn) and locate supporting paragraphs.
3. Analyze EACH feedback item to see which checklist items it mentions, and which paragraph(s) / segment(s) of the essay it is talking about.

You are NOT grading; you are only doing precise, structured analysis.
Do NOT mix data between different works. Treat each work_id independently.

--------------------
INPUT FORMAT
--------------------
You will receive a single JSON object:
{
  "works": [
    {
      "work_id": 0,
      "paragraphs": [
        { "id": 1, "text": "..." },
        { "id": 2, "text": "..." }
      ],
      "feedback_items": [
        { "id": 1, "title": "...", "text": "..." },
        { "id": 2, "title": "...", "text": "..." }
      ]
    }
  ],
  "template_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition"
    }
  ],
  "knowledge_checklist": [
    {
      "id": 1,
      "name": "C1",
      "description": "Specific knowledge point description"
    }
  ]
}

Notes about the input:
- paragraphs: the student's essay has already been split into numbered paragraphs/sentences (IDs are 1,2,3,...).
- feedback_items: rubric-style feedback for THIS essay. Each feedback has:
  - id: numeric
  - title: section title such as "CONCEPTS & ACCURACY: Meets (8 pts)" (may be empty)
  - text: the feedback content text (can be multiple sentences or bullet points)
- template_segments: a FIXED segmentation template derived from model works. You MUST use it to structure the essay.
- knowledge_checklist: global checklist items C1–Cn shared across ALL works. Each item has id, name (e.g. "C1"), and description.

--------------------
TASK 1: ESSAY SEGMENTATION (USING TEMPLATE)
--------------------
Goal: For each work, use template_segments as the target structure and assign every essay paragraph to EXACTLY ONE segment.

Rules:
1. You MUST keep the NUMBER, ORDER, and IDs of segments exactly the same as in template_segments.
   - For segment i in template_segments, the output segment for this work must have the same id and name.
2. Every paragraph.id in this work MUST appear in exactly one segment's paragraph_ids array.
3. Segments should be logically meaningful based on the essay content:
   - Earlier structural parts (definitions, introductions, context) usually go into earlier segments.
   - Analysis, case discussion, application, and conclusions go into mid/late segments as appropriate.
4. If the essay is short or does not obviously follow the template, still distribute all paragraph_ids into segments in a reasonable way.
   - Do NOT leave any paragraph unassigned.

Output for each work (field: "essay_segments"):
  "essay_segments": [
    {
      "id": 1,
      "name": "Part 1: Introduction and Definition",
      "paragraph_ids": [1, 2]
    },
    {
      "id": 2,
      "name": "Part 2: ...",
      "paragraph_ids": [3, 4, 5]
    }
  ]

--------------------
TASK 2: ESSAY → KNOWLEDGE CHECKLIST (for Essay Matrix)
--------------------
Goal: For each work, determine which paragraphs of the essay clearly demonstrate each knowledge checklist item C1–Cn.
This mapping is used to color the **essay matrix**: "Does this essay satisfy checklist item Ck, and where?"

For EACH checklist item in knowledge_checklist:
1. Carefully read its description and the entire essay (all paragraphs).
2. Decide whether the essay clearly demonstrates this specific knowledge / skill.
   - You must be able to point to at least one paragraph where this checklist item is clearly shown.
3. When the essay satisfies a checklist item:
   - Collect ALL paragraph IDs that provide strong, direct evidence for this item.
   - Paragraphs may be non-contiguous. Only include paragraphs that are clearly relevant.
4. When the essay does NOT clearly satisfy a checklist item, use an empty paragraph_ids array.

Be honest but not over-conservative:
- If there is a clear, explicit paragraph that matches the checklist description, you SHOULD mark it as satisfied.
- Do NOT infer satisfaction from vague or generic text.

Output for each work (field: "essay_checklist_mappings"):
  "essay_checklist_mappings": [
    {
      "checklist_id": 1,          // from knowledge_checklist.id
      "paragraph_ids": [2, 3]     // ALL paragraphs that clearly show this item; [] if not satisfied
    },
    {
      "checklist_id": 2,
      "paragraph_ids": []
    }
  ]
You MUST include one entry for EVERY checklist item id in knowledge_checklist.

--------------------
TASK 3: FEEDBACK → CHECKLIST & ESSAY LOCATION (for Feedback Matrix)
--------------------
Goal: For each work, and for EACH feedback item:
- Decide which checklist items C1–Cn this feedback is talking about (if any).
- Decide which paragraph(s) of the essay this feedback mainly refers to.
- From the paragraph mapping, derive which essay segment(s) (from Task 1) this feedback is about.

Interpretation rules for feedback:
1. Use BOTH title and text when interpreting the meaning of the feedback.
2. A feedback "mentions" or "is about" a checklist item when:
   - It clearly criticizes, praises, or comments on the student's performance on that specific knowledge/skill, OR
   - It uses language that closely matches or paraphrases the checklist description.
3. One feedback may refer to multiple checklist items, or to none.

Mapping to checklist items:
- For each feedback, build checklist_items as an array of checklist ids from knowledge_checklist that best match what this feedback is about.
- If the feedback is purely generic praise (e.g. "Nice work!", "Good job overall") and does not connect to any specific knowledge item, leave checklist_items as an empty array [] for that feedback.

Mapping to essay paragraphs:
1. For each feedback, choose the paragraph(s) whose content the feedback is MOST clearly talking about.
2. You MUST return at least ONE paragraph id when the feedback is about any concrete aspect of the essay.
   - Prefer 1–3 paragraph IDs that are the strongest matches.
   - If the feedback explicitly references multiple distinct parts of the essay, you may include up to 3 relevant paragraph_ids.
3. Only when a feedback is entirely generic and cannot be reasonably tied to any specific paragraph (e.g. "Great job!" with no detail), you may return an empty paragraph_ids array.
4. Avoid being over-conservative: if you can reasonably infer which paragraph(s) the feedback refers to, you SHOULD return those paragraph IDs.

Mapping to essay parts (segments):
1. For each feedback, after you have selected related_paragraph_ids, determine which segments from essay_segments contain those paragraphs.
2. essay_part_ids must be the list of segment ids whose paragraph_ids include any of the related_paragraph_ids.
   - In most cases this will be a single segment id; multiple are allowed if the feedback clearly spans multiple segments.

Output for each work (field: "feedback_mappings"):
  "feedback_mappings": [
    {
      "feedback_id": 1,               // from feedback_items.id
      "related_paragraph_ids": [3],   // 1–3 best matching paragraph IDs; [] only if feedback is totally generic
      "checklist_items": [1, 3],      // ids from knowledge_checklist that this feedback talks about
      "essay_part_ids": [2]           // segment ids from essay_segments that contain those paragraphs
    },
    {
      "feedback_id": 2,
      "related_paragraph_ids": [],
      "checklist_items": [],
      "essay_part_ids": []
    }
  ]
You MUST output one mapping object for EVERY feedback_items.id in the input.

--------------------
OVERALL OUTPUT FORMAT
--------------------
You must return a single JSON object:
{
  "works": [
    {
      "work_id": 0,
      "essay_segments": [ ... ],            // from TASK 1
      "essay_checklist_mappings": [ ... ],  // from TASK 2
      "feedback_mappings": [ ... ]          // from TASK 3
    },
    {
      "work_id": 1,
      "essay_segments": [ ... ],
      "essay_checklist_mappings": [ ... ],
      "feedback_mappings": [ ... ]
    }
  ]
}

REQUIRED CONSISTENCY:
- Every work from input "works" must appear exactly once in output "works".
- Within each work:
  - Every paragraph.id must appear in exactly ONE element of essay_segments[].paragraph_ids.
  - essay_checklist_mappings must contain EXACTLY ONE entry for each knowledge_checklist.id.
  - feedback_mappings must contain EXACTLY ONE entry for each feedback_items.id.
  - For each feedback mapping:
    - related_paragraph_ids can be [] only if the feedback is completely generic and cannot be matched to any paragraphs.
    - essay_part_ids must be consistent with essay_segments and related_paragraph_ids.
- All IDs (work_id, paragraph ids, checklist ids, segment ids, feedback ids) must match the input exactly.
- The JSON must be valid and follow this schema exactly.
`;

export async function combinedPhase1AndPhase2Batch(
  works,
  templateSegments = null,
  checklistItems = []
) {
  const prompt = [
    { role: "system", content: systemPrompt() },
    { role: "assistant", content: combinedPhase1AndPhase2BatchPrompt },
    {
      role: "user",
      content: JSON.stringify({
        works,
        template_segments: templateSegments,
        knowledge_checklist: checklistItems,
      }),
    },
  ];

  try {
    const openAiResponse = await fetchFromOpenAi({
      model: "gpt-5.2",
      response_format: { type: "json_object" },
      max_completion_tokens: 8192,
      temperature: 0.2,
      messages: prompt,
    }, 600000); // 10 minutes

    if (openAiResponse.error) {
      throw new Error(openAiResponse.error.message);
    }

    const response = openAiResponse.choices?.[0]?.message?.content;
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.error("combinedPhase1AndPhase2Batch error", e);
    throw e;
  }
}

export async function generateImage(list) {
  const rsp = await fetchFromOpenAiImage({
    model: "dall-e-3",
    prompt: imagePrompt(list),
    size: "1024x1024", // 也可以 "1024x1536"/"1536x1024"/"auto"
    quality: "hd", // standard/hd
    // quality: "low",        // high/medium/low/auto
    response_format: "b64_json", //dall-e-3 专用
    style: "natural", //dall-e-3 专用
    // output_format: "png",   // png/jpeg/webp（GPT Image 专用）
    n: 1,
    // background: "auto",     // auto/transparent/opaque（透明背景要 png/webp）
  });

  const b64 = rsp.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned");
  return b64;
}
