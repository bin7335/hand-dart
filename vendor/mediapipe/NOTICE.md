# vendor/mediapipe

이 폴더의 파일은 직접 만든 것이 아니라 아래에서 그대로 가져온 것이에요.

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `vision_bundle.mjs`, `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm` | npm `@mediapipe/tasks-vision` 1.2.2 (Google) | Apache-2.0 |
| `hand_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` (Google) | Apache-2.0 |

- 라이선스 전문: https://www.apache.org/licenses/LICENSE-2.0
- 바꾼 점: `vision_bundle.mjs` 맨 끝의 `sourceMappingURL` 주석 한 줄만 지웠어요.
- 버전을 올릴 때는 세 파일을 같은 버전으로 함께 바꿔야 해요.
