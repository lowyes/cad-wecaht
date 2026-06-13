# CAD Drawing Recognition Algorithm

## Current Goal

The backend verifies this loop:

```text
uploaded drawing -> reference model library -> recognition result -> glTF URL
```

The current dataset has one real model, `part_0001`, and a small regression set:

- Positive examples: `scan_test_01`, `scan_test_02`, `scan_test_03`
- Negative examples: `scan_test_04`, `scan_test_05`, `scan_test_06`, `scan_test_07`, `scan_test_08`, `random_noise`, `noise_test`

## Current Pipeline

### 1. Preprocessing

Implemented in `services/image_preprocess.py`.

The image is converted to grayscale and normalized for engineering drawings:

- Crop large white borders.
- Estimate and correct small skew angles.
- Optionally correct perspective.
- Resize to a stable working size.
- Normalize shadows.
- Apply local contrast enhancement.
- Sharpen thin drawing lines.
- Produce multiple binary/gray modes: `gray`, `otsu`, `adaptive`, `edge`.

The skew correction currently uses the measured Hough-line angle directly. This fixed a previous issue where some drawings became more tilted after deskewing.

### 2. Feature Extraction

Implemented in `services/feature_extract.py`.

The main descriptor is SIFT:

- SIFT is more robust than ORB for blur, scale changes, and slight rotation.
- Reference features are saved in `data/features/<model_id>.npz`.
- Keypoints are serialized so RANSAC can use their original coordinates.

SIFT is useful for candidate recall, but it is not enough as the final judge for CAD drawings because many parts share repeated primitives: straight lines, dashed lines, circles, holes, arrows, and dimension text.

### 3. Descriptor Matching

Implemented in `services/matcher.py`.

The matcher uses:

- BFMatcher with L2 distance for SIFT descriptors.
- Lowe ratio test to keep stronger local matches.
- RANSAC homography to estimate geometric consistency.
- Inlier count, inlier ratio, and inlier coverage as core matching signals.

The homography sanity check rejects degenerate transforms. This is important because repeated CAD structures can produce plausible local matches that do not represent the same model.

### 4. Engineering-Line Layout Score

The matcher also extracts normalized horizontal and vertical line segments from the query and reference drawings.

This is a generic CAD signal, not a part-specific rule:

- It compares major horizontal/vertical engineering-line layout.
- It helps recover low-quality scans where SIFT/RANSAC is close but not strong enough.
- It is computed per reference image, so it can scale to more model IDs.

### 5. Component Shape Score

The current matcher also compares large view components:

- Extract large connected drawing components.
- Normalize each component mask to a fixed size.
- Compare internal component shape using tolerant IoU and correlation.

This was added because `scan_test_07` looked globally similar to `part_0001` in three-view layout but was a different part. Component shape comparison is more discriminative than line layout alone.

### 6. Automatic View-Region Matching

Implemented in `services/view_region_detector.py`.

The matcher now adds a layout-independent region layer:

- Preprocess each drawing into a binary black-line image.
- Use multi-scale morphology close/dilate to connect lines inside the same view.
- Extract connected components as candidate view regions.
- Filter tiny annotations, isolated dimension text, noise, and extreme boxes.
- Merge nearby/overlapping boxes.
- Match every query region against every reference region.
- Greedily keep the best non-overlapping region pairs.

Each region pair is scored by:

```text
region_pair_score = 0.45 * SIFT/RANSAC feature_score + 0.55 * edge_structure_score
```

A drawing is considered region-supported only when at least two reference regions are matched. This is useful for CAD drawings because a negative image may share one local primitive, such as a circle or rectangle, but is less likely to match multiple independent view regions.

The reference feature build also saves automatically detected reference regions:

```text
data/ref_regions/<model_id>/region_XX.png
data/features/<model_id>_region_XX_sift.npz
```

This avoids hard-coding fixed `front/top/side` coordinates and makes the flow easier to scale to new layouts.

### 7. Decision Rule

There are two ways to match:

1. Strict match:
   - Enough RANSAC inliers.
   - Enough inlier coverage.
   - Valid homography.
   - Confidence above threshold.

2. Near-miss promotion:
   - Used for degraded scans.
   - Requires enough inliers, inlier ratio, coverage, and line-layout score.
   - For clearer images, also requires component shape similarity or automatic region support.

This keeps blurry positives such as `scan_test_01` recoverable while rejecting visually similar negatives such as `scan_test_07`.

## Current Validation Result

The current regression set passes:

```text
scan_test_01 -> MATCH
scan_test_02 -> MATCH
scan_test_03 -> MATCH
scan_test_04 -> REJECT
scan_test_05 -> REJECT
scan_test_06 -> REJECT
scan_test_07 -> REJECT
scan_test_08 -> REJECT
random_noise -> REJECT
noise_test -> REJECT
```

The full backend harness also passes and confirms:

- Manifest is readable.
- glTF and bin files are reachable.
- Feature index is valid.
- `/api/health` works.
- `/api/models` returns `part_0001`.
- `/api/recognize` returns a matched `top1` with a glTF URL for the reference image.

Current region diagnostics:

```text
scan_test_01 -> regions 2/2, region_score 0.269
scan_test_02 -> regions 2/2, region_score 0.450
scan_test_03 -> regions 2/2, region_score 0.273
negative samples -> regions 0/2
```

## Scaling To 300 Models

The current single-model setup asks:

```text
Does this drawing look like part_0001?
```

With 300 models, the system must ask:

```text
Which model is the best match, and is it clearly better than the alternatives?
```

For 300 models, the recommended production flow is:

```text
query image
-> preprocessing
-> SIFT/descriptor retrieval for topK candidates
-> RANSAC verification for topK
-> line-layout and component-shape verification
-> top1/top2 margin check
-> return top1 or reject/ask for manual confirmation
```

Do not rely on only the highest score. The API should eventually check:

- `top1_score`
- `top2_score`
- `top1_score - top2_score`
- `top1_score / top2_score`
- per-model calibrated thresholds

If top1 and top2 are too close, the backend should return low confidence or a candidate list instead of forcing a match.

## Better Algorithm Options

### Short Term

- Keep SIFT as a candidate recall layer.
- Add topK ranking once there are multiple models.
- Add top1/top2 margin rejection.
- Keep a labeled positive/negative regression set for every new model.
- Store per-model reference statistics such as descriptor count, line-layout score distribution, and component-shape score distribution.

### Medium Term

- Use multiple reference images per model: clean CAD export, blurred scan, rotated scan, photographed scan.
- Build a feature index with FLANN or FAISS-like vector retrieval for faster topK candidate search.
- Use local view/component matching instead of one global homography, because engineering drawings contain multiple orthographic views.
- Add per-view alignment: match front/top/side components independently.

### Long Term

- Train a metric-learning model or Siamese network on labeled positive/negative CAD drawing pairs.
- Use deep local features such as SuperPoint/SuperGlue or DISK/LightGlue for more reliable correspondences.
- Add OCR/dimension extraction as a second modality when dimensions are readable.
- Combine visual shape matching with structured CAD metadata when available.

## Important Limitation

The current algorithm is a strong classical baseline, not a final 300-model production recognizer.

It can be improved incrementally, but a large model library needs:

- More labeled negative samples.
- Multiple references per model.
- Candidate ranking across all models.
- Confidence calibration.
- A clear reject/uncertain state.
