# PhotoTune User Study Plan

## Goal

Evaluate whether PhotoTune helps users reach visually pleasing and consistent photo edits faster than manual editing or fixed rules.

## Conditions

1. Manual: users edit with sliders only.
2. Rule-based: users start from fixed heuristic suggestions.
3. Model-based: users start from PhotoTune recommendations produced from image statistics or trained FiveK weights.

## Task

Each participant edits one single photo and one batch of three to five photos from the same event or trip. The target is a final image set they would be willing to post on social media.

## Metrics

- Editing time from upload to export.
- Number of slider changes and feedback actions.
- Final satisfaction rating from 1 to 7.
- Batch consistency rating from 1 to 7.
- Preference ranking among the three conditions.

## Procedure

Counterbalance the order of conditions across participants. Use the same photo sets for each participant, but rotate which set appears with each condition to reduce learning effects.

## Logged Data

The backend stores recommendation, apply, feedback, and batch apply events in `backend/phototune.db`. Each row includes `session_id`, optional `image_id`, `event_type`, JSON payload, and timestamp.
