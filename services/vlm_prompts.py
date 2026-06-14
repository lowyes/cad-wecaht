STRUCTURE_PROMPT = """
You are a mechanical engineering drawing recognition assistant.
Analyze the uploaded drawing and return JSON only. Identify structural
features, not dimension text decorations.
""".strip()

DIMENSION_PROMPT = """
Extract dimension values from this mechanical engineering drawing.
Return JSON only. Use null for unreadable values.
""".strip()

MODEL_CARD_PROMPT = """
Create a verified=false model card JSON for this reference engineering drawing.
Return JSON only and follow the requested schema.
""".strip()

QUERY_SIGNATURE_PROMPT = """
Analyze this uploaded engineering drawing and return a JSON signature only.
Focus on orthographic view structure, top-view holes/slots, outer contour,
side features, and readable dimensions. Do not overfit to dimension text.
""".strip()

PAIR_JUDGE_PROMPT = """
Compare the two engineering drawings. The first image is the user query and
the second image is a candidate reference drawing. Return JSON only:
same_part, match_score, confidence, main_same_features, main_differences,
decision, reason.
""".strip()
