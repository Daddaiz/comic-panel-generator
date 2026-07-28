// ===================================================================
// Comic Panel Generator for SillyTavern
// Generates a real comic (grid of panels with speech balloons) from the
// last chat message, using:
//  1) the LLM already connected in SillyTavern to split the scene into N
//     panels, each with a visual description + optional dialogue
//  2) NanoGPT's image API to generate the image for each panel,
//     optionally using the avatars of the characters involved in the
//     chat as reference (or custom reference images)
// ===================================================================

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE_NAME = "comicPanelGenerator";

// Documented NanoGPT endpoints:
// - Generation (OpenAI-compatible, text->image only): .../api/v1/images/generations
//   https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai
// - "Normalized" image API (supports input_references for img-to-img):
//   https://docs.nano-gpt.com/api-reference/image-generation
// - Model list + supported parameters:
//   https://docs.nano-gpt.com/api-reference/endpoint/image-models
const NANOGPT_DOCS_URL = "https://docs.nano-gpt.com/api-reference/endpoint/image-models";
const NANOGPT_MODELS_ENDPOINT = "https://nano-gpt.com/api/v1/image-models?detailed=true";
const NANOGPT_IMAGES_NORMALIZED_ENDPOINT = "https://nano-gpt.com/api/v1/images";
// Fallback limit if we can't read the model-specific constraint
// (for Qwen Image, confirmed via the NanoGPT UI, the real limit is 3).
const DEFAULT_MAX_INPUT_REFERENCES = 3;

const STYLE_PRESETS = {
    generico: "comic book art, bold ink outlines, halftone shading, dynamic panel composition, high contrast",
    manga: "colorful manga/anime art style, vibrant colors, 2D anime/manga illustration style, flat cel shading, bold clean ink linework, dynamic speed lines, Japanese comic book art, hand-drawn illustration, expressive anime-style eyes, not a photograph",
    disney: "Disney animated feature style, warm vibrant colors, expressive characters, clean vector lineart, classic storybook illustration",
};

const QUALITY_NEGATIVE_PROMPT =
    "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, " +
    "worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, " +
    "artist name, bad feet, pixelated, distorted, oversaturated, plastic-looking, artificial, " +
    "unnatural proportions, over-smoothed, airbrushed, mutated hands, fused fingers, " +
    "bad pose, twisted torso, broken pose, impossible pose, unnatural pose, disconnected limbs, " +
    "floating limbs, extra limbs, missing limbs, malformed legs, bent knees wrong direction, " +
    "awkward sitting position, bad perspective, poorly drawn anatomy, " +
    "looking at viewer, looking at camera, eye contact with viewer, fourth wall break";

// Qwen Image prompt optimization, based on:
// https://civitai.com/articles/30826/qwen-image-2512-prompt-guide-and-best-practices
// Key takeaways applied here:
//  - structured labeled prompts (Subject/Pose/Clothing/Camera/Environment/
//    Lighting/Mood) outperform narrative sentences for this model
//  - subject should come first, environment/lighting after
//  - keep it concise, don't let it sprawl
//  - "golden config" recommended by the guide: CFG 4.5 + 50 inference steps
function isQwenModel(modelId) {
    return /qwen/i.test(modelId || "");
}

// Qwen Image defaults, per the verified NanoGPT API spec for this model
// (previously guessed at CFG 4.5 / 50 steps from a generic community
// guide — this is the actual platform default for this route/model).
const QWEN_GUIDANCE_SCALE = 2.5;
const QWEN_INFERENCE_STEPS = 30;

const defaultSettings = {
    apiKey: "",
    apiEndpoint: "https://nano-gpt.com/api/v1/images/generations",
    model: "qwen-image",
    imageSize: "1024x1024",
    numPanels: 4,
    comicStyle: "generico", // "generico" | "manga" | "disney"
    styleSuffix: STYLE_PRESETS.generico,
    keyVisualDetails: "",
    includeClothingStyleText: false,
    qualityNegativePrompt: QUALITY_NEGATIVE_PROMPT,
    source: "last_ai", // "last_ai" | "last_any" | "custom"
    customText: "",
    insertIntoChat: true,
    useCharacterAvatars: true,
    useLastPanelAsReference: true,
    useFirstPanelAsReference: false,
    firstReferenceByChat: {}, // { [chatId]: dataUrl } — the very first generated image of each conversation
    perModelGenerationParams: {}, // { [modelId]: { steps, cfg } }
    activeProviderId: "nanogpt", // "nanogpt" | one of customProviders[].id
    customProviders: [], // [{ id, name, endpoint, apiKey, noAuth, bodyTemplate, responseImagePath, responseType, supportsReferences, referencesPlaceholder }]
    personaAvatarFile: "",
    translateVisualToEnglish: true,
    includeCharacterAppearance: true,
    reviewPromptsBeforeGenerating: true,
    referenceImages: [], // [{ url: "..." }]
    showCaptions: false,
    nsfw: false,
};

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }
    return extension_settings[MODULE_NAME];
}

function settings() {
    return extension_settings[MODULE_NAME];
}

function notify(type, message) {
    try {
        if (window.toastr) {
            (window.toastr[type] || window.toastr.info)(message);
            return;
        }
    } catch (e) { /* ignore */ }
    console.log(`[Comic Panel Generator] ${type}: ${message}`);
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
}

// ------------------------------------------------------------------
// Settings UI
// ------------------------------------------------------------------

function buildSettingsHtml() {
    const s = settings();
    return `
    <div id="comic_panel_generator_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🖼️ Comic Panel Generator</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <details class="cpg-group">
                    <summary>🔌 Image Provider</summary>

                    <div class="cpg-row">
                        <label for="cpg_provider_select">Provider</label>
                        <select id="cpg_provider_select">
                            <option value="nanogpt" ${s.activeProviderId === "nanogpt" ? "selected" : ""}>NanoGPT</option>
                            ${(s.customProviders || [])
                                .map((p) => `<option value="${p.id}" ${s.activeProviderId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
                                .join("")}
                            <option value="__new__">➕ Add new custom / local server...</option>
                        </select>
                    </div>

                    <div id="cpg_custom_provider_editor" style="display:none; margin-top:8px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.15);">
                        <div class="cpg-row">
                            <label for="cpg_cp_name">Provider name</label>
                            <input id="cpg_cp_name" type="text" placeholder="e.g. My Local Fooocus-API" />
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_endpoint">Endpoint URL</label>
                            <input id="cpg_cp_endpoint" type="text" placeholder="http://127.0.0.1:8888/v1/generation/text-to-image" />
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_noauth">No authentication needed</label>
                            <input id="cpg_cp_noauth" type="checkbox" />
                            <span style="font-size:0.75em; opacity:0.7;">Typical for local software running on your own machine.</span>
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_apikey">API Key</label>
                            <input id="cpg_cp_apikey" type="password" placeholder="only if the server requires one" />
                        </div>
                        <div class="cpg-row" style="align-items:flex-start;">
                            <label for="cpg_cp_body_template">Request body template</label>
                            <div style="flex:1;">
                                <textarea id="cpg_cp_body_template" style="min-height:180px; font-family:monospace; font-size:0.8em;"></textarea>
                                <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                    Must be valid JSON once placeholders are filled in. Available placeholders:
                                    <code>{{prompt}}</code>, <code>{{negative_prompt}}</code>, <code>{{steps}}</code>,
                                    <code>{{cfg}}</code>, <code>{{width}}</code>, <code>{{height}}</code>, <code>{{seed}}</code>,
                                    <code>{{n}}</code>, <code>{{nsfw}}</code> (true/false), <code>{{has_references}}</code> (true/false),
                                    <code>{{images_json}}</code> (JSON array of reference images, base64 or URLs),
                                    <code>{{first_reference_base64}}</code> (just the first one, for APIs that only take one).
                                    This extension only supports synchronous request→response APIs (send once, get the
                                    image back in the same reply) — not job/polling-based APIs.
                                </span>
                            </div>
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_response_path">Response image path</label>
                            <input id="cpg_cp_response_path" type="text" placeholder="e.g. data[0].url or [0].base64" />
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_response_type">Response type</label>
                            <select id="cpg_cp_response_type">
                                <option value="url">URL (a link to the image)</option>
                                <option value="base64">Base64 (raw image data)</option>
                            </select>
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_supports_refs">Supports reference images</label>
                            <input id="cpg_cp_supports_refs" type="checkbox" />
                        </div>
                        <div class="cpg-row">
                            <label for="cpg_cp_max_refs">Max reference images</label>
                            <input id="cpg_cp_max_refs" type="number" min="0" max="10" step="1" value="1" />
                        </div>
                        <div class="cpg-buttons">
                            <button id="cpg_cp_load_fooocus_btn" class="menu_button" type="button">📋 Load Fooocus-API starting template</button>
                            <button id="cpg_cp_save_btn" class="menu_button" type="button">💾 Save this provider</button>
                            <button id="cpg_cp_delete_btn" class="menu_button" type="button">🗑️ Delete this provider</button>
                        </div>
                        <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:6px;">
                            ⚠️ The Fooocus-API template is an unverified starting point based on its general public
                            schema — it has not been tested against a live server. Check your own running instance's
                            interactive docs (usually at <code>http://127.0.0.1:8888/docs</code>) for the exact,
                            guaranteed-correct field names for your version, and adjust the template above to match.
                        </span>
                    </div>
                </details>

                <details class="cpg-group">
                    <summary>🔑 API &amp; Model (NanoGPT)</summary>

                    <div class="cpg-row">
                        <label for="cpg_api_key">NanoGPT API Key</label>
                        <input id="cpg_api_key" type="password" placeholder="sk-..." value="${s.apiKey}" />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_endpoint">Generation endpoint</label>
                        <input id="cpg_endpoint" type="text" value="${s.apiEndpoint}" />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_model">Image model</label>
                        <input id="cpg_model" type="text" placeholder="qwen-image" value="${s.model}" />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_model_list">Available models</label>
                        <select id="cpg_model_list">
                            <option value="">— load the list first —</option>
                        </select>
                        <button id="cpg_load_models_btn" class="menu_button" type="button">🔄 Load available models</button>
                    </div>

                    <div class="cpg-row">
                        <label>Documentation</label>
                        <span>
                            <a href="${NANOGPT_DOCS_URL}" target="_blank" rel="noopener">
                                Image models list and supported parameters (NanoGPT docs) ↗
                            </a>
                        </span>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_size">Size</label>
                        <select id="cpg_size">
                            <option value="1024x1024">1024x1024 (square)</option>
                            <option value="1024x1792">1024x1792 (portrait)</option>
                            <option value="1792x1024">1792x1024 (landscape)</option>
                            <option value="512x512">512x512 (fast)</option>
                        </select>
                        <span style="font-size:0.8em; opacity:0.75;">(auto-updates based on the chosen model, when available)</span>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_steps">Steps</label>
                        <input id="cpg_steps" type="number" min="1" max="50" step="1" value="${QWEN_INFERENCE_STEPS}" />
                        <span style="font-size:0.8em; opacity:0.75;">Auto-filled from the selected model's own default/range (like NanoGPT's own UI).</span>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_cfg">CFG Scale</label>
                        <input id="cpg_cfg" type="number" min="1" max="20" step="0.5" value="${QWEN_GUIDANCE_SCALE}" />
                        <span style="font-size:0.8em; opacity:0.75;">Also auto-filled per model, remembered separately for each one.</span>
                    </div>
                </details>

                <details class="cpg-group">
                    <summary>🎬 Comic Settings</summary>

                    <div class="cpg-row">
                        <label for="cpg_num_panels">Number of panels</label>
                        <input id="cpg_num_panels" type="number" min="1" max="9" step="1" value="${s.numPanels}" />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_comic_style">Comic style</label>
                        <select id="cpg_comic_style">
                            <option value="generico">Generic (western comic)</option>
                            <option value="manga">Manga (black & white, screentone)</option>
                            <option value="disney">Disney / animation</option>
                        </select>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_source">Text source</label>
                        <select id="cpg_source">
                            <option value="last_ai">Last character message</option>
                            <option value="last_any">Last message (anyone)</option>
                            <option value="custom">Custom text (below)</option>
                        </select>
                    </div>

                    <div class="cpg-row" id="cpg_custom_text_row">
                        <label for="cpg_custom_text">Custom text</label>
                        <textarea id="cpg_custom_text" placeholder="Write here the scene to turn into a comic...">${s.customText}</textarea>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_style">Art style (prompt suffix)</label>
                        <textarea id="cpg_style">${s.styleSuffix}</textarea>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_include_clothing_style">Include clothing &amp; art style in prompt text</label>
                        <div style="flex:1;">
                            <input id="cpg_include_clothing_style" type="checkbox" ${s.includeClothingStyleText ? "checked" : ""} />
                            <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                Off (default): the prompt won't describe the character's clothing or include the
                                "Art style" suffix at all — relying entirely on the reference image for those
                                details, which can preserve character likeness/features noticeably better. On:
                                writes both into the prompt text as before.
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_key_details">Key visual details (always included)</label>
                        <div style="flex:1;">
                            <textarea id="cpg_key_details" placeholder="e.g. dangly emerald earrings, red lipstick, brown hooded cloak, white blouse with plunging neckline">${s.keyVisualDetails}</textarea>
                            <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                Small must-have details (jewelry, makeup, headwear...) that reference images often
                                drop. Added to EVERY panel's prompt as text.
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_neg_prompt">Negative prompt (quality)</label>
                        <textarea id="cpg_neg_prompt">${s.qualityNegativePrompt}</textarea>
                    </div>
                </details>

                <details class="cpg-group">
                    <summary>🌍 Language &amp; Prompt Handling</summary>

                    <div class="cpg-row">
                        <label for="cpg_translate">Translate panel prompt to English</label>
                        <input id="cpg_translate" type="checkbox" ${s.translateVisualToEnglish ? "checked" : ""} />
                        <span style="font-size:0.75em; opacity:0.7;">
                            Recommended: image models understand English much better. Isolated translation step,
                            separate from panel/dialogue generation, with automatic fallback to the original text.
                        </span>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_appearance">Reinforce character appearance in text</label>
                        <input id="cpg_appearance" type="checkbox" ${s.includeCharacterAppearance ? "checked" : ""} />
                        <span style="font-size:0.75em; opacity:0.7;">
                            Fallback only: reference images always take priority. Only kicks in for characters with
                            NO reference image available, using their character card's "description" field.
                        </span>
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_review_prompts">Review prompts before generating</label>
                        <input id="cpg_review_prompts" type="checkbox" ${s.reviewPromptsBeforeGenerating ? "checked" : ""} />
                        <span style="font-size:0.75em; opacity:0.7;">
                            Shows the exact prompt for every panel in editable boxes before any image is generated —
                            useful for debugging and tweaking a prompt by hand.
                        </span>
                    </div>
                </details>

                <details class="cpg-group">
                    <summary>🧑‍🤝‍🧑 Character &amp; Persona References</summary>

                    <div class="cpg-row">
                        <label for="cpg_use_avatars">Use character avatars as reference</label>
                        <input id="cpg_use_avatars" type="checkbox" ${s.useCharacterAvatars ? "checked" : ""} />
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_use_last_panel">Use last generated panel as extra reference</label>
                        <div style="flex:1;">
                            <input id="cpg_use_last_panel" type="checkbox" ${s.useLastPanelAsReference ? "checked" : ""} />
                            <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                From the 2nd panel onward, adds the previous panel's image as an extra reference to
                                help keep the art consistent panel-to-panel.
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_use_first_panel">Keep first generated image as a permanent reference</label>
                        <div style="flex:1;">
                            <input id="cpg_use_first_panel" type="checkbox" ${s.useFirstPanelAsReference ? "checked" : ""} />
                            <button id="cpg_forget_first_panel_btn" class="menu_button" type="button" style="margin-left:6px;">🗑️ Forget stored reference for this chat</button>
                            <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                The very first image generated in each conversation is remembered and reused as an
                                extra reference for every future panel in that same chat — on top of, not instead
                                of, the character/persona avatars (which stay relevant regardless of the scene).
                                If the story later moves somewhere very different (e.g. home → beach) and this old
                                reference starts looking out of place, use the button above to forget it — a new
                                one will then be captured from the next panel you generate.
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_persona_file">Your persona avatar filename</label>
                        <div style="flex:1; min-width:220px;">
                            <input id="cpg_persona_file" type="text" placeholder="auto-detected if possible, or enter manually" value="${s.personaAvatarFile}" style="width:100%;" />
                            <span id="cpg_persona_autodetect_status" style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                The extension tries to auto-detect this on its own; this field is only needed as a
                                manual override/fallback if auto-detection doesn't work on your setup. Only the FILE
                                NAME, not the full URL. Leave empty + auto-detect off to disable entirely.
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label for="cpg_ref_url">Extra reference images</label>
                        <div style="flex:1; min-width:220px;">
                            <div style="display:flex; gap:6px; margin-bottom:6px;">
                                <input id="cpg_ref_url" type="text" placeholder="https://... (public image URL)" style="flex:1;" />
                                <button id="cpg_ref_add_btn" class="menu_button" type="button">➕</button>
                            </div>
                            <div id="cpg_ref_list" class="cpg-ref-list"></div>
                            <span style="font-size:0.75em; opacity:0.7; display:block; margin-top:4px;">
                                Max references depends on the chosen model (see Steps/CFG section above once loaded).
                            </span>
                        </div>
                    </div>

                    <div class="cpg-row" style="align-items:flex-start;">
                        <label></label>
                        <div style="flex:1;">
                            <button id="cpg_preview_refs_btn" class="menu_button" type="button">🔍 Preview reference images</button>
                            <div id="cpg_ref_preview" class="cpg-ref-preview"></div>
                        </div>
                    </div>
                </details>

                <details class="cpg-group">
                    <summary>📤 Output Options</summary>

                    <div class="cpg-row">
                        <label for="cpg_insert_chat">Insert result into chat</label>
                        <input id="cpg_insert_chat" type="checkbox" ${s.insertIntoChat ? "checked" : ""} />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_show_captions">Show captions below panels</label>
                        <input id="cpg_show_captions" type="checkbox" ${s.showCaptions ? "checked" : ""} />
                    </div>

                    <div class="cpg-row">
                        <label for="cpg_nsfw">NSFW content</label>
                        <input id="cpg_nsfw" type="checkbox" ${s.nsfw ? "checked" : ""} />
                        <span style="font-size:0.75em; opacity:0.7;">
                            On: adds "NSFW" to the positive prompt. Off: adds it to the negative prompt instead
                            (model-dependent).
                        </span>
                    </div>
                </details>

                <div class="cpg-buttons">
                    <button id="cpg_generate_btn" class="menu_button">🎬 Generate comic</button>
                    <button id="cpg_test_btn" class="menu_button">🔧 Test API connection</button>
                </div>

                <div id="cpg_status" class="cpg-status"></div>
            </div>
        </div>
    </div>`;
}

function setStatus(text) {
    const el = document.getElementById("cpg_status");
    if (el) el.textContent = text;
}

function renderReferenceList() {
    const s = settings();
    const container = document.getElementById("cpg_ref_list");
    if (!container) return;

    if (!s.referenceImages || s.referenceImages.length === 0) {
        container.innerHTML = `<span style="font-size:0.8em; opacity:0.7;">No reference images added yet.</span>`;
        return;
    }

    container.innerHTML = s.referenceImages
        .map(
            (ref, i) => `
        <div class="cpg-ref-item" data-idx="${i}">
            <img src="${ref.url}" alt="ref ${i + 1}" />
            <span class="cpg-ref-url" title="${escapeHtml(ref.url)}">${escapeHtml(ref.url)}</span>
            <span class="cpg-ref-remove" data-idx="${i}">✖</span>
        </div>`
        )
        .join("");

    container.querySelectorAll(".cpg-ref-remove").forEach((el) => {
        el.addEventListener("click", (e) => {
            const idx = parseInt(e.target.getAttribute("data-idx"), 10);
            s.referenceImages.splice(idx, 1);
            saveSettingsDebounced();
            renderReferenceList();
        });
    });
}

function updateCustomTextVisibility() {
    const s = settings();
    const row = document.getElementById("cpg_custom_text_row");
    if (row) row.style.display = s.source === "custom" ? "" : "none";
}

function bindSettingsEvents() {
    const s = settings();

    // ---- Accordion behavior: opening one section closes the others ----
    const allGroups = document.querySelectorAll("#comic_panel_generator_settings .cpg-group");
    allGroups.forEach((group) => {
        group.addEventListener("toggle", () => {
            if (group.open) {
                allGroups.forEach((other) => {
                    if (other !== group) other.open = false;
                });
            }
        });
    });

    // ---- Provider selection & custom provider editor ----

    let editingProviderId = null; // null = "new" (not yet saved)

    function clearCustomProviderForm() {
        document.getElementById("cpg_cp_name").value = "";
        document.getElementById("cpg_cp_endpoint").value = "";
        document.getElementById("cpg_cp_noauth").checked = false;
        document.getElementById("cpg_cp_apikey").value = "";
        document.getElementById("cpg_cp_body_template").value = "";
        document.getElementById("cpg_cp_response_path").value = "";
        document.getElementById("cpg_cp_response_type").value = "url";
        document.getElementById("cpg_cp_supports_refs").checked = false;
        document.getElementById("cpg_cp_max_refs").value = "1";
    }

    function fillCustomProviderForm(provider) {
        document.getElementById("cpg_cp_name").value = provider.name || "";
        document.getElementById("cpg_cp_endpoint").value = provider.endpoint || "";
        document.getElementById("cpg_cp_noauth").checked = !!provider.noAuth;
        document.getElementById("cpg_cp_apikey").value = provider.apiKey || "";
        document.getElementById("cpg_cp_body_template").value = provider.bodyTemplate || "";
        document.getElementById("cpg_cp_response_path").value = provider.responseImagePath || "";
        document.getElementById("cpg_cp_response_type").value = provider.responseType || "url";
        document.getElementById("cpg_cp_supports_refs").checked = !!provider.supportsReferences;
        document.getElementById("cpg_cp_max_refs").value = String(provider.maxReferences || 1);
    }

    function refreshProviderDropdown(selectId) {
        const select = document.getElementById("cpg_provider_select");
        select.innerHTML =
            `<option value="nanogpt">NanoGPT</option>` +
            (s.customProviders || [])
                .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
                .join("") +
            `<option value="__new__">➕ Add new custom / local server...</option>`;
        select.value = selectId;
    }

    document.getElementById("cpg_provider_select").addEventListener("change", (e) => {
        const value = e.target.value;
        const editor = document.getElementById("cpg_custom_provider_editor");

        if (value === "nanogpt") {
            s.activeProviderId = "nanogpt";
            saveSettingsDebounced();
            editor.style.display = "none";
            if (s.model) applyGenerationParamsForModelUI(s.model);
            return;
        }

        if (value === "__new__") {
            editingProviderId = null;
            clearCustomProviderForm();
            editor.style.display = "";
            return;
        }

        // An existing custom provider was selected — activate it and load it into the editor
        const provider = (s.customProviders || []).find((p) => p.id === value);
        if (!provider) return;
        s.activeProviderId = value;
        saveSettingsDebounced();
        editingProviderId = value;
        fillCustomProviderForm(provider);
        editor.style.display = "";

        const savedParams = s.perModelGenerationParams?.[provider.id];
        document.getElementById("cpg_steps").value = typeof savedParams?.steps === "number" ? savedParams.steps : QWEN_INFERENCE_STEPS;
        document.getElementById("cpg_cfg").value = typeof savedParams?.cfg === "number" ? savedParams.cfg : QWEN_GUIDANCE_SCALE;
    });

    document.getElementById("cpg_cp_load_fooocus_btn").addEventListener("click", () => {
        document.getElementById("cpg_cp_name").value = FOOOCUS_API_TEMPLATE.name;
        document.getElementById("cpg_cp_endpoint").value = FOOOCUS_API_TEMPLATE.endpoint;
        document.getElementById("cpg_cp_noauth").checked = FOOOCUS_API_TEMPLATE.noAuth;
        document.getElementById("cpg_cp_apikey").value = FOOOCUS_API_TEMPLATE.apiKey;
        document.getElementById("cpg_cp_body_template").value = FOOOCUS_API_TEMPLATE.bodyTemplate;
        document.getElementById("cpg_cp_response_path").value = FOOOCUS_API_TEMPLATE.responseImagePath;
        document.getElementById("cpg_cp_response_type").value = FOOOCUS_API_TEMPLATE.responseType;
        document.getElementById("cpg_cp_supports_refs").checked = FOOOCUS_API_TEMPLATE.supportsReferences;
        notify("info", "Fooocus-API starting template loaded — please verify it against your own server's /docs before relying on it.");
    });

    document.getElementById("cpg_cp_save_btn").addEventListener("click", () => {
        const name = document.getElementById("cpg_cp_name").value.trim();
        const endpoint = document.getElementById("cpg_cp_endpoint").value.trim();
        const bodyTemplate = document.getElementById("cpg_cp_body_template").value;

        if (!name || !endpoint) {
            notify("error", "Please fill in at least a provider name and an endpoint URL.");
            return;
        }
        try {
            // Sanity check: template should be valid JSON with placeholders removed
            JSON.parse(bodyTemplate.replace(/\{\{[a-z_]+\}\}/gi, "0"));
        } catch (err) {
            notify("error", "The request body template doesn't look like valid JSON. Check for typos (see console).");
            console.error("[Comic Panel Generator] Body template JSON check failed:", err);
            return;
        }

        const provider = {
            id: editingProviderId || `custom-${Date.now()}`,
            name,
            endpoint,
            noAuth: document.getElementById("cpg_cp_noauth").checked,
            apiKey: document.getElementById("cpg_cp_apikey").value,
            bodyTemplate,
            responseImagePath: document.getElementById("cpg_cp_response_path").value.trim(),
            responseType: document.getElementById("cpg_cp_response_type").value,
            supportsReferences: document.getElementById("cpg_cp_supports_refs").checked,
            maxReferences: parseInt(document.getElementById("cpg_cp_max_refs").value, 10) || 1,
        };

        if (!s.customProviders) s.customProviders = [];
        const existingIndex = s.customProviders.findIndex((p) => p.id === provider.id);
        if (existingIndex >= 0) {
            s.customProviders[existingIndex] = provider;
        } else {
            s.customProviders.push(provider);
        }
        s.activeProviderId = provider.id;
        editingProviderId = provider.id;
        saveSettingsDebounced();
        refreshProviderDropdown(provider.id);
        notify("success", `Provider "${name}" saved and activated.`);
    });

    document.getElementById("cpg_cp_delete_btn").addEventListener("click", () => {
        if (!editingProviderId) {
            notify("info", "Nothing to delete — this provider hasn't been saved yet.");
            return;
        }
        s.customProviders = (s.customProviders || []).filter((p) => p.id !== editingProviderId);
        if (s.activeProviderId === editingProviderId) {
            s.activeProviderId = "nanogpt";
        }
        saveSettingsDebounced();
        editingProviderId = null;
        clearCustomProviderForm();
        document.getElementById("cpg_custom_provider_editor").style.display = "none";
        refreshProviderDropdown(s.activeProviderId);
        notify("success", "Provider deleted.");
    });

    // If a custom provider is already active on load, show its editor pre-filled
    if (s.activeProviderId && s.activeProviderId !== "nanogpt") {
        const activeProvider = (s.customProviders || []).find((p) => p.id === s.activeProviderId);
        if (activeProvider) {
            editingProviderId = activeProvider.id;
            fillCustomProviderForm(activeProvider);
            document.getElementById("cpg_custom_provider_editor").style.display = "";
        }
    }

    document.getElementById("cpg_api_key").addEventListener("input", (e) => {
        s.apiKey = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_endpoint").addEventListener("input", (e) => {
        s.apiEndpoint = e.target.value.trim();
        saveSettingsDebounced();
    });
    document.getElementById("cpg_model").addEventListener("input", (e) => {
        s.model = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_model").addEventListener("blur", (e) => {
        const modelId = e.target.value.trim();
        if (modelId) applyGenerationParamsForModelUI(modelId);
    });
    document.getElementById("cpg_model_list").addEventListener("change", (e) => {
        const modelId = e.target.value;
        if (!modelId) return;
        s.model = modelId;
        document.getElementById("cpg_model").value = modelId;
        saveSettingsDebounced();
        applyResolutionsForModel(modelId);
        applyGenerationParamsForModelUI(modelId);
    });
    document.getElementById("cpg_load_models_btn").addEventListener("click", onLoadModelsClick);

    document.getElementById("cpg_steps").addEventListener("input", (e) => {
        const value = parseFloat(e.target.value);
        if (isNaN(value)) return;
        const paramKey = getActiveCustomProvider(s)?.id || s.model;
        if (!s.perModelGenerationParams) s.perModelGenerationParams = {};
        if (!s.perModelGenerationParams[paramKey]) s.perModelGenerationParams[paramKey] = {};
        s.perModelGenerationParams[paramKey].steps = value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_cfg").addEventListener("input", (e) => {
        const value = parseFloat(e.target.value);
        if (isNaN(value)) return;
        const paramKey = getActiveCustomProvider(s)?.id || s.model;
        if (!s.perModelGenerationParams) s.perModelGenerationParams = {};
        if (!s.perModelGenerationParams[paramKey]) s.perModelGenerationParams[paramKey] = {};
        s.perModelGenerationParams[paramKey].cfg = value;
        saveSettingsDebounced();
    });

    document.getElementById("cpg_size").addEventListener("change", (e) => {
        s.imageSize = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_size").value = s.imageSize;

    document.getElementById("cpg_num_panels").addEventListener("input", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val)) val = defaultSettings.numPanels;
        val = Math.max(1, Math.min(9, val));
        s.numPanels = val;
        saveSettingsDebounced();
    });

    document.getElementById("cpg_comic_style").addEventListener("change", (e) => {
        s.comicStyle = e.target.value;
        s.styleSuffix = STYLE_PRESETS[s.comicStyle] || STYLE_PRESETS.generico;
        document.getElementById("cpg_style").value = s.styleSuffix;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_comic_style").value = s.comicStyle;

    document.getElementById("cpg_source").addEventListener("change", (e) => {
        s.source = e.target.value;
        saveSettingsDebounced();
        updateCustomTextVisibility();
    });
    document.getElementById("cpg_source").value = s.source;
    updateCustomTextVisibility();

    document.getElementById("cpg_custom_text").addEventListener("input", (e) => {
        s.customText = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_style").addEventListener("input", (e) => {
        s.styleSuffix = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_include_clothing_style").addEventListener("change", (e) => {
        s.includeClothingStyleText = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_key_details").addEventListener("input", (e) => {
        s.keyVisualDetails = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_translate").addEventListener("change", (e) => {
        s.translateVisualToEnglish = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_appearance").addEventListener("change", (e) => {
        s.includeCharacterAppearance = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_review_prompts").addEventListener("change", (e) => {
        s.reviewPromptsBeforeGenerating = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_neg_prompt").addEventListener("input", (e) => {
        s.qualityNegativePrompt = e.target.value;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_insert_chat").addEventListener("change", (e) => {
        s.insertIntoChat = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_show_captions").addEventListener("change", (e) => {
        s.showCaptions = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_nsfw").addEventListener("change", (e) => {
        s.nsfw = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_use_avatars").addEventListener("change", (e) => {
        s.useCharacterAvatars = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_use_last_panel").addEventListener("change", (e) => {
        s.useLastPanelAsReference = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_use_first_panel").addEventListener("change", (e) => {
        s.useFirstPanelAsReference = e.target.checked;
        saveSettingsDebounced();
    });
    document.getElementById("cpg_forget_first_panel_btn").addEventListener("click", () => {
        const chatId = getCurrentChatIdentifier();
        if (s.firstReferenceByChat && s.firstReferenceByChat[chatId]) {
            delete s.firstReferenceByChat[chatId];
            saveSettingsDebounced();
            notify("success", "Forgot the stored first-panel reference for this chat — a new one will be captured next time.");
        } else {
            notify("info", "No stored first-panel reference found for this chat.");
        }
    });
    document.getElementById("cpg_persona_file").addEventListener("input", (e) => {
        s.personaAvatarFile = e.target.value.trim();
        saveSettingsDebounced();
    });

    document.getElementById("cpg_ref_add_btn").addEventListener("click", () => {
        const input = document.getElementById("cpg_ref_url");
        const url = (input.value || "").trim();
        if (!url) return;
        if (!s.referenceImages) s.referenceImages = [];
        s.referenceImages.push({ url });
        input.value = "";
        saveSettingsDebounced();
        renderReferenceList();
    });

    document.getElementById("cpg_preview_refs_btn").addEventListener("click", onPreviewReferencesClick);

    document.getElementById("cpg_generate_btn").addEventListener("click", onGenerateClick);
    document.getElementById("cpg_test_btn").addEventListener("click", onTestClick);

    renderReferenceList();
}

// ------------------------------------------------------------------
// Pulsante nel menu "bacchetta magica" (extensionsMenu) in basso
// ------------------------------------------------------------------

function injectWandMenuButton(retriesLeft = 20) {
    const menu = document.getElementById("extensionsMenu");
    if (!menu) {
        // The menu might not be in the DOM yet on the first attempt: retry.
        if (retriesLeft > 0) {
            setTimeout(() => injectWandMenuButton(retriesLeft - 1), 500);
        } else {
            console.warn("[Comic Panel Generator] #extensionsMenu not found, button not added.");
        }
        return;
    }

    if (document.getElementById("cpg_wand_button")) return; // already inserted

    const item = document.createElement("div");
    item.id = "cpg_wand_button";
    item.className = "list-group-item flex-container flexGap5 interactable";
    item.tabIndex = 0;
    item.innerHTML = `
        <div class="fa-solid fa-images extensionsMenuExtensionIcon"></div>
        <span>Generate comic</span>
    `;
    item.addEventListener("click", onGenerateClick);
    menu.appendChild(item);
}

// ------------------------------------------------------------------
// Fetching the source text from chat
// ------------------------------------------------------------------

function getSourceText() {
    const s = settings();
    const context = getContext();

    if (s.source === "custom") {
        return (s.customText || "").trim();
    }

    const chat = context.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const mes = chat[i];
        if (!mes || mes.is_system) continue;
        if (s.source === "last_ai" && mes.is_user) continue;
        if (mes.mes && mes.mes.trim().length > 0) {
            let text = mes.mes.trim();

            // If this is a character/AI message, also prepend the player's
            // own most recent message (usually short) right before it, so
            // the panel-splitting LLM knows what the player actually said/
            // did that led to this response — helps it depict the player's
            // own dialogue/action in the comic too, not just the
            // character's reaction to something unstated.
            if (!mes.is_user) {
                for (let j = i - 1; j >= 0; j--) {
                    const prev = chat[j];
                    if (!prev || prev.is_system) continue;
                    if (prev.is_user && prev.mes && prev.mes.trim().length > 0) {
                        const userName = context.name1 || "User";
                        const charName = mes.name || context.name2 || "Character";
                        text = `${userName}: ${prev.mes.trim()}\n\n${charName}: ${text}`;
                        console.log(`[Comic Panel Generator] Included the player's previous message as context (from "${userName}").`);
                        break;
                    }
                    break; // stop at the first non-system message either way, don't scan further back
                }
            }

            return text;
        }
    }
    return "";
}

// ------------------------------------------------------------------
// Splitting the scene into N panels (visual description + dialogue),
// via the LLM already connected in SillyTavern (generateQuietPrompt)
// ------------------------------------------------------------------

async function splitIntoPanels(sourceText, numPanels) {
    const context = getContext();
    const s = settings();
    const useQwenFormat = isQwenModel(s.model);
    const includeClothing = s.includeClothingStyleText;

    const fieldOrder = includeClothing
        ? "Subject: ...\\nPose: ...\\nClothing: ...\\nCamera: ...\\nEnvironment: ...\\nLighting: ...\\nMood: ..."
        : "Subject: ...\\nPose: ...\\nCamera: ...\\nEnvironment: ...\\nLighting: ...\\nMood: ...";
    const clothingNote = includeClothing
        ? ""
        : ` Do NOT include a "Clothing" field or describe clothing/outfit at all — the reference image already ` +
          `conveys it, and repeating it in text tends to conflict with the reference and distort the character's ` +
          `likeness.`;

    const gazeNote =
        ` Where the character(s) are looking is part of "Pose" and matters a lot: by default, when two or more ` +
        `characters are interacting, they should be looking at EACH OTHER (making eye contact), reflecting ` +
        `what's actually happening between them — not posed for a photo. Only have them look away from each ` +
        `other in specific narrative cases where that makes sense (e.g. an argument, tension, one character ` +
        `avoiding the other's gaze, distraction, a solo introspective moment). Characters should almost NEVER ` +
        `look directly at the camera/viewer (breaking the fourth wall) — reserve that only for a rare, ` +
        `deliberate dramatic beat if the scene truly calls for it, not as a default.`;

    const visualFieldSpec = useQwenFormat
        ? `"visual": a STRUCTURED, labeled visual description of the panel — NOT a narrative sentence. ` +
          `Use short labeled lines in this exact order, each on its own line inside the string (use \\n), ` +
          `subject first: "${fieldOrder}". ` +
          `Skip a label only if truly not applicable.${clothingNote} Keep each line short and concrete, no filler words, no dialogue/text in this field. ` +
          `For "Pose" specifically, be anatomically EXPLICIT, not just a single vague word: describe the exact ` +
          `body configuration (e.g. instead of just "sitting", write "sitting on a chair, back straight, both ` +
          `feet flat on the floor, hands resting on knees" — specify what supports the body, where the limbs ` +
          `are, and the weight distribution). Vague one-word poses like "sitting" or "standing" are a common ` +
          `cause of anatomically wrong or distorted results from the image model, so always spell out the ` +
          `concrete physical arrangement instead.${gazeNote}`
        : `"visual": short vivid PURELY VISUAL description of the panel (setting, camera angle, mood, no text/no ` +
          `dialogue in this field).${clothingNote} For the character's pose specifically, be anatomically explicit rather than ` +
          `a single vague word: instead of just "sitting", describe the exact body configuration (what supports ` +
          `it, where the limbs are, e.g. "sitting on a chair, back straight, feet flat on the floor, hands on ` +
          `knees") — vague poses are a common cause of distorted results from the image model.${gazeNote}`;

    let appearanceBlock = "";
    if (s.includeCharacterAppearance) {
        const notes = getCharacterAppearanceNotes();
        if (notes.length > 0) {
            appearanceBlock =
                `\n\nCHARACTER APPEARANCE REFERENCE (use these to keep hair, eyes, build, and other physical ` +
                `traits CONSISTENT across all panels — repeat the relevant details in the "visual"/"Subject" ` +
                `field of every panel where that character appears):\n${notes.join("\n")}\n`;
        }
    }

    // The scene is written from the user's own character's perspective/
    // presence too, not just the AI character(s) — but the "visual" field
    // instruction above talks about a single "Subject", which tends to bias
    // the LLM toward only describing whoever is speaking. Explicitly name
    // the user's persona and require multi-character coverage so the
    // player's own character doesn't silently disappear from panels where
    // they're actually present and doing something.
    const personaName = (context.name1 || "").trim() || "the user's own character";
    const multiCharacterBlock =
        `\n\nIMPORTANT — don't focus only on whoever is speaking: the scene may involve MULTIPLE characters ` +
        `at once, including the user's own character/persona, named "${personaName}". Read the scene carefully ` +
        `and, for every panel, identify ALL characters who are actually present and doing something in that ` +
        `specific panel — not just the one with a line of dialogue. Describe each visible character's own pose ` +
        `and action in the "visual"/"Subject" field (e.g. "Subject: ${personaName} sitting on the bed, reaching ` +
        `for X; [OtherCharacter] standing near the door, arms crossed" — adapt names/actions to what's actually ` +
        `happening). If a panel is genuinely a solo shot of just one character, that's fine too — but don't ` +
        `default to a single character out of habit when the scene clearly describes others being there.`;

    const instruction =
        `You are a comic book storyboard artist. Break the following scene into exactly ${numPanels} ` +
        `comic panels. Reply with ONLY a valid JSON array (no markdown fences, no commentary), where each ` +
        `element has this shape:\n` +
        `{${visualFieldSpec}, ` +
        `"dialogue": [{"speaker": "character name or 'Narratore'", "text": "short line, max 12 words", ` +
        `"type": "speech" or "thought"}]}\n` +
        `Use "type":"speech" for anything actually said out loud, and "type":"thought" for internal/unspoken ` +
        `thoughts, inner monologue, or narration. The "dialogue" array can be empty if the panel is silent. ` +
        `Keep each dialogue line very short (comic speech balloon length). Output must be valid JSON parseable ` +
        `with JSON.parse, nothing else.${multiCharacterBlock}${appearanceBlock}\n\n` +
        `SCENE:\n${sourceText}`;

    let raw = "";
    try {
        if (typeof context.generateQuietPrompt === "function") {
            raw = await context.generateQuietPrompt(instruction, false, false);
        } else {
            throw new Error("generateQuietPrompt not available");
        }
    } catch (err) {
        console.warn("[Comic Panel Generator] generateQuietPrompt failed, using local fallback:", err);
        notify("warning", "⚠️ LLM split failed: using a local fallback that does NOT translate to English (image prompts may stay in the original language).");
        return naiveSplit(sourceText, numPanels);
    }

    const parsed = tryParsePanelsJson(raw);
    if (parsed && parsed.length > 0) {
        while (parsed.length < numPanels) {
            parsed.push(parsed[parsed.length - 1]);
        }
        return parsed.slice(0, numPanels).map(normalizePanelObject);
    }

    notify("warning", "⚠️ LLM response was not valid JSON: using a local fallback that does NOT translate to English.");
    return naiveSplit(sourceText, numPanels);
}

function tryParsePanelsJson(raw) {
    if (!raw) return null;
    let text = raw.trim();
    // Strip any ```json ... ``` markdown fence
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    // Isolate the first JSON array found, in case the LLM adds surrounding text
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        text = text.slice(firstBracket, lastBracket + 1);
    }

    try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) return data;
        return null;
    } catch (err) {
        console.warn("[Comic Panel Generator] Failed to parse panels JSON:", err, raw);
        return null;
    }
}

function normalizePanelObject(p) {
    if (!p || typeof p !== "object") {
        return { visual: String(p || "").slice(0, 300), dialogue: [] };
    }
    const visual = (p.visual || p.description || "").toString().trim() || "comic panel scene";
    let dialogue = Array.isArray(p.dialogue) ? p.dialogue : [];
    dialogue = dialogue
        .filter((d) => d && (d.text || d.line))
        .map((d) => ({
            speaker: (d.speaker || d.name || "").toString().trim(),
            text: (d.text || d.line || "").toString().trim(),
            type: (d.type || "").toString().trim().toLowerCase() === "thought" ? "thought" : "speech",
        }))
        .slice(0, 3); // max 3 balloons per panel, to avoid clutter
    return { visual, dialogue };
}

function naiveSplit(text, numPanels) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    if (sentences.length === 0) {
        return Array.from({ length: numPanels }, () => ({ visual: text.slice(0, 200), dialogue: [] }));
    }
    const chunks = [];
    const perChunk = Math.max(1, Math.ceil(sentences.length / numPanels));
    for (let i = 0; i < numPanels; i++) {
        const chunk = sentences.slice(i * perChunk, (i + 1) * perChunk).join(" ") || sentences[sentences.length - 1];
        chunks.push({ visual: chunk, dialogue: [] });
    }
    return chunks;
}

// ------------------------------------------------------------------
// Shared per-model endpoint metadata (single source of truth), fetched
// once per model from GET /api/v1/images/models/{modelId}/endpoints —
// this is where NanoGPT declares each model's real constraints:
// input_reference_constraints (max reference images), and per-model
// supported_parameters like resolution options, num_inference_steps
// (Steps) and guidance_scale (CFG Scale) with their own default/min/max
// — these genuinely differ per model (e.g. Qwen Image defaults to CFG
// 2.5 / 30 steps, WAI Illustrious SDXL to CFG 7.5 / 20 steps), so we
// read them from NanoGPT itself instead of hardcoding one model's values.
// https://docs.nano-gpt.com/api-reference/image-generation
// ------------------------------------------------------------------

const modelEndpointMetadataCache = {};

async function fetchModelEndpointMetadata(modelId) {
    if (!modelId) return null;
    if (modelEndpointMetadataCache[modelId] !== undefined) return modelEndpointMetadataCache[modelId];

    try {
        const s = settings();
        const headers = { "Content-Type": "application/json" };
        if (s.apiKey) headers["Authorization"] = `Bearer ${s.apiKey}`;

        const url = `https://nano-gpt.com/api/v1/images/models/${encodeURIComponent(modelId)}/endpoints`;
        const response = await fetch(url, { method: "GET", headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const endpoint = Array.isArray(data?.endpoints) ? data.endpoints[0] : null;
        modelEndpointMetadataCache[modelId] = endpoint || null;
        console.log(`[Comic Panel Generator] Endpoint metadata loaded for "${modelId}":`, endpoint);
        return endpoint || null;
    } catch (err) {
        console.warn(`[Comic Panel Generator] Could not fetch endpoint metadata for "${modelId}":`, err);
        modelEndpointMetadataCache[modelId] = null;
        return null;
    }
}

async function getMaxReferencesForModel(modelId) {
    const s = settings();
    const customProvider = getActiveCustomProvider(s);
    if (customProvider) {
        return customProvider.supportsReferences ? (customProvider.maxReferences || 1) : 0;
    }
    if (!modelId) return DEFAULT_MAX_INPUT_REFERENCES;
    const endpoint = await fetchModelEndpointMetadata(modelId);
    const maxItems = endpoint?.input_reference_constraints?.max_items;
    const resolved = typeof maxItems === "number" && maxItems > 0 ? maxItems : DEFAULT_MAX_INPUT_REFERENCES;
    console.log(`[Comic Panel Generator] input_references limit for "${modelId}": ${resolved}`);
    return resolved;
}

// Whether this model uses the "structured" generation endpoint/params
// (imageDataUrl(s), nImages, resolution, guidance_scale, num_inference_steps,
// showExplicitContent...) as verified directly against NanoGPT's own API
// export for Qwen Image — verified TWICE, directly by the person using
// this extension, against NanoGPT's own site. That confirmation is
// treated as authoritative and checked FIRST, regardless of what the
// endpoint-metadata lookup below concludes — that lookup hits an endpoint
// (GET /api/v1/images/models/{id}/endpoints) whose existence/shape was
// never actually confirmed against a live response, only assumed from
// general REST conventions. If it silently returns something that doesn't
// look like what we expect, Qwen must not fall back to the wrong (old,
// unverified) endpoint. The metadata lookup remains useful as a way to
// *additionally* detect other models exposed the same way (e.g. WAI
// Illustrious SDXL), just not as the deciding vote for Qwen itself.
async function usesStructuredGenerationFormat(modelId) {
    if (isQwenModel(modelId)) return true;

    const endpoint = await fetchModelEndpointMetadata(modelId);
    if (!endpoint) return false;
    const paramNames = endpoint?.supported_parameters ? Object.keys(endpoint.supported_parameters) : [];
    return paramNames.includes("imageDataUrl") || paramNames.includes("imageDataUrls") || paramNames.includes("nImages");
}

// Reads this model's own declared Steps/CFG Scale default+range, so the
// settings panel can show (and generation can use) the correct values for
// whichever model is actually selected, instead of one-size-fits-all.
async function getGenerationParamDefaults(modelId) {
    const endpoint = await fetchModelEndpointMetadata(modelId);
    const stepsParam = endpoint?.supported_parameters?.num_inference_steps;
    const cfgParam = endpoint?.supported_parameters?.guidance_scale;
    return {
        steps: {
            default: typeof stepsParam?.default === "number" ? stepsParam.default : QWEN_INFERENCE_STEPS,
            min: typeof stepsParam?.min === "number" ? stepsParam.min : 1,
            max: typeof stepsParam?.max === "number" ? stepsParam.max : 50,
        },
        cfg: {
            default: typeof cfgParam?.default === "number" ? cfgParam.default : QWEN_GUIDANCE_SCALE,
            min: typeof cfgParam?.min === "number" ? cfgParam.min : 1,
            max: typeof cfgParam?.max === "number" ? cfgParam.max : 20,
            step: typeof cfgParam?.step === "number" ? cfgParam.step : 0.5,
        },
    };
}

// ------------------------------------------------------------------
// Reference images: chat character avatars + custom ones
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Reads the REAL pixel dimensions directly out of a PNG/JPEG's own file
// header, decoded locally — no trust placed in anything a server says
// about the image. Used purely for diagnostics: NanoGPT's own
// "image too large" error reported a nonsense size (65536x4292542531,
// suspiciously close to a 32-bit integer overflow), so this lets us
// confirm with hard numbers whether an oversized/malformed image is
// really being sent, or whether that error message itself is unreliable.
// ------------------------------------------------------------------

// Re-draws an image onto a blank canvas and re-exports it as a clean PNG,
// stripping any embedded metadata (EXIF, ICC color profiles, custom PNG
// text chunks, etc.) that the original file might carry — without
// changing the visible pixels at all. Used specifically for the "reuse
// last panel as reference" feature: an AI-generated image can carry
// unusual embedded metadata from its own generation pipeline, and NanoGPT
// reported a nonsense "image too large" size for a reference whose real,
// locally-decoded dimensions were completely normal — consistent with
// their parser getting confused by something in the file other than the
// actual pixel data. Since the source is always a same-origin data: URL
// by this point (already fetched via blobUrlToDataUrl), this canvas
// operation is not subject to CORS tainting.
async function reencodeImageCleanly(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL("image/png"));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error("Failed to load image for clean re-encoding"));
        img.src = dataUrl;
    });
}

function decodeImageDimensionsFromDataUrl(dataUrl) {
    try {
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) return { format: "unknown", width: null, height: null };
        // Only need the first few KB to find the header info — decoding the
        // whole (potentially multi-MB) base64 string would be wasteful.
        const base64Head = dataUrl.slice(commaIdx + 1, commaIdx + 1 + 12000);
        const binary = atob(base64Head);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // PNG: 8-byte signature, then IHDR chunk with width @ offset 16-19
        // and height @ offset 20-23 (big-endian 32-bit each).
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
            const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
            return { format: "png", width, height };
        }

        // JPEG: scan markers for a Start-Of-Frame segment (0xFFC0–0xFFCF,
        // excluding the DHT/JPG-reserved 0xC4/0xC8/0xCC), which encodes
        // height then width as 2-byte big-endian values.
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            let i = 2;
            while (i < bytes.length - 9) {
                if (bytes[i] !== 0xff) {
                    i++;
                    continue;
                }
                const marker = bytes[i + 1];
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    const height = (bytes[i + 5] << 8) | bytes[i + 6];
                    const width = (bytes[i + 7] << 8) | bytes[i + 8];
                    return { format: "jpeg", width, height };
                }
                const segmentLength = (bytes[i + 2] << 8) | bytes[i + 3];
                i += 2 + segmentLength;
            }
            return { format: "jpeg", width: null, height: null, note: "SOF marker not found in the first ~9KB decoded" };
        }

        return { format: "unknown", width: null, height: null };
    } catch (err) {
        return { format: "error", width: null, height: null, error: err.message };
    }
}

async function blobUrlToDataUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download image: ${response.status}`);
    const blob = await response.blob();

    // Guard against a "200 OK" response that isn't actually an image (e.g.
    // an HTML error/login page served with a 200 status instead of a real
    // 404). Without this check, that content would silently be encoded as
    // a bogus "image" and sent to NanoGPT, which can then fail with a
    // confusing "input image too large" error and nonsense dimensions —
    // a symptom of it trying to read image headers out of non-image bytes.
    if (blob.type && !blob.type.startsWith("image/")) {
        throw new Error(`URL did not return an image (content-type: "${blob.type}"), got ${blob.size} bytes — likely an error page instead of the expected file.`);
    }
    if (blob.size < 100) {
        throw new Error(`URL returned a suspiciously tiny file (${blob.size} bytes) — likely not a real image.`);
    }

    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
    });
}

// ------------------------------------------------------------------
// Identifies the current chat, so the "first generated image of this
// conversation" reference can be stored/retrieved per-chat rather than
// globally. Tries the most likely context property/function first; if
// none is available, falls back to a rough (not guaranteed-unique, but
// usually stable enough for a single ongoing chat) identifier built from
// what IS available, and says so clearly in the console.
// ------------------------------------------------------------------

function getCurrentChatIdentifier() {
    const context = getContext();
    if (typeof context.chatId === "string" && context.chatId) {
        return context.chatId;
    }
    if (typeof context.getCurrentChatId === "function") {
        try {
            const id = context.getCurrentChatId();
            if (id) return String(id);
        } catch (e) {
            // fall through to the fallback below
        }
    }
    const chat = context.chat || [];
    const fallback = `${context.name2 || context.characterId || "unknown"}-${chat[0]?.send_date || chat.length}`;
    console.warn(`[Comic Panel Generator] Could not find a confirmed chat ID property — using a best-effort fallback ("${fallback}") to key the "first panel reference" storage. This should be stable for one ongoing conversation, but isn't a guaranteed-unique chat ID.`);
    return fallback;
}

function getRecentSpeakingCharacterNames(maxCount) {
    const context = getContext();
    const chat = context.chat || [];
    const userName = context.name1;

    const seenNames = [];
    for (let i = chat.length - 1; i >= 0 && seenNames.length < maxCount; i--) {
        const mes = chat[i];
        if (!mes || mes.is_user || mes.is_system) continue;
        const name = (mes.name || "").trim();
        if (name && name !== userName && !seenNames.includes(name)) {
            seenNames.push(name);
        }
    }

    if (seenNames.length === 0 && context.name2) {
        seenNames.push(context.name2);
    }

    return seenNames;
}

// ------------------------------------------------------------------
// Character appearance notes, pulled from the SillyTavern character
// card's "description" field. Image references (input_references)
// often act more like a loose style/composition hint than a true
// identity lock, especially on general-purpose img2img models — so
// physical traits (hair, eyes, build...) can drift between panels if
// they're only conveyed through the reference image. Repeating them in
// TEXT, in every panel's prompt, is currently a more reliable way to
// keep them consistent. This feeds the character card's own
// description to the panel-splitting LLM as context, so it can weave
// consistent physical details into each panel itself.
// ------------------------------------------------------------------

function getCharacterAppearanceNotes(maxCharacters = 3, maxCharsEach = 280) {
    const s = settings();
    const context = getContext();
    const characters = context.characters || [];
    const names = getRecentSpeakingCharacterNames(maxCharacters);

    const notes = [];
    for (const name of names) {
        const character = characters.find((c) => c && c.name === name);

        // Reference image takes priority over a text description: if this
        // character already has a usable avatar and avatars are enabled as
        // references, skip the text note entirely for them — text
        // appearance notes are only a fallback for characters with no
        // reference image available.
        const hasAvatarReference = s.useCharacterAvatars && character && character.avatar && character.avatar !== "none";
        if (hasAvatarReference) {
            console.log(`[Comic Panel Generator] Skipping text appearance note for "${name}" — a reference image is already used for them (image takes priority).`);
            continue;
        }

        const desc = (character?.description || "").trim();
        if (!desc) continue;
        const snippet = desc.length > maxCharsEach ? desc.slice(0, maxCharsEach).trim() + "…" : desc;
        notes.push(`${name}: ${snippet}`);
    }

    if (notes.length > 0) {
        console.log(`[Comic Panel Generator] Character appearance notes included for consistency (no reference image available for these):`, notes);
    } else {
        console.log(`[Comic Panel Generator] No text appearance notes needed — either every character has a reference image, or none has a description.`);
    }

    return notes;
}

async function getCharacterAvatarEntries(maxCount) {
    const context = getContext();
    const characters = context.characters || [];
    const seenNames = getRecentSpeakingCharacterNames(maxCount);

    console.log(`[Comic Panel Generator] Characters found in chat: ${seenNames.join(", ") || "(none)"}`);

    const entries = [];
    for (const name of seenNames) {
        if (entries.length >= maxCount) break;
        const character = characters.find((c) => c && c.name === name);
        if (!character || !character.avatar || character.avatar === "none") {
            console.warn(`[Comic Panel Generator] ⚠️ No avatar found for "${name}" (character found: ${!!character}, avatar: ${character?.avatar || "n/a"}) — excluded from references.`);
            continue;
        }

        // Try the FULL-RESOLUTION original file first ("characters/Name.png",
        // same storage-path convention SillyTavern itself documents for
        // avatars — confirmed via its own slash-command path enums), THEN
        // fall back to the thumbnail-generator endpoint. The thumbnail
        // endpoint almost always succeeds (it just resizes/compresses), so
        // trying it FIRST (as this code used to) meant the full-resolution
        // original was never actually used — likely explaining lower/
        // different-looking img2img results compared to uploading the
        // original image directly on NanoGPT's own site.
        const candidateUrls = [`${window.location.origin}/characters/${encodeURIComponent(character.avatar)}`];
        if (typeof context.getThumbnailUrl === "function") {
            candidateUrls.push(context.getThumbnailUrl("avatar", character.avatar));
        }
        candidateUrls.push(`/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`);

        let fetched = false;
        for (const rawPath of candidateUrls) {
            const fullUrl = rawPath.startsWith("http") ? rawPath : `${window.location.origin}${rawPath}`;
            try {
                console.log(`[Comic Panel Generator] ✅ Trying full-res avatar of "${name}" from: ${fullUrl}`);
                const dataUrl = await blobUrlToDataUrl(fullUrl);
                entries.push({ label: `Character: ${name}`, url: dataUrl });
                fetched = true;
                break;
            } catch (err) {
                console.warn(`[Comic Panel Generator] Avatar of "${name}" not reachable at ${fullUrl}:`, err);
            }
        }
        if (!fetched) {
            console.warn(`[Comic Panel Generator] ⚠️ Avatar of "${name}" could not be fetched as a reference via any known path.`);
        }
    }

    return entries;
}

function isLocalOrRelativeUrl(url) {
    try {
        // Relative URL (e.g. "/thumbnail?...") without protocol/host
        if (!/^https?:\/\//i.test(url)) return true;
        const u = new URL(url);
        return (
            u.hostname === "127.0.0.1" ||
            u.hostname === "localhost" ||
            u.hostname === window.location.hostname
        );
    } catch (e) {
        return true; // if it's not a parseable URL, treat it as "needs conversion" and let it fail with a clear error
    }
}

async function resolveManualReference(url) {
    if (!isLocalOrRelativeUrl(url)) {
        return url; // public URL: NanoGPT can download it directly
    }
    // Local URL (e.g. http://127.0.0.1:8000/thumbnail?type=persona&file=...):
    // NanoGPT can't reach it remotely, so we download it ourselves in the
    // browser and convert it to base64 before sending it.
    console.log(`[Comic Panel Generator] Local reference URL detected, converting to base64: ${url}`);
    return await blobUrlToDataUrl(url);
}

// Best-effort auto-detection of the persona avatar filename, tried before
// falling back to the manual "Your persona avatar filename" field. This is
// NOT based on a confirmed/documented SillyTavern API — it tries a few
// plausible properties/patterns across ST versions, logs clearly which one
// (if any) worked, and simply falls through to the next attempt (and
// ultimately to the manual field) if none pan out. No promises, but no
// harm either: worst case, it behaves exactly like before.
// Extracts just the filename from either URL shape SillyTavern seems to
// use for persona avatars: the thumbnail-generator endpoint
// (/thumbnail?type=persona&file=NAME.png) or a direct static path
// (/User%20Avatars/NAME.png).
function extractAvatarFilenameFromUrl(url) {
    try {
        const u = new URL(url, window.location.origin);
        const fileParam = u.searchParams.get("file");
        if (fileParam) return decodeURIComponent(fileParam);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length > 0) return decodeURIComponent(parts[parts.length - 1]);
        return null;
    } catch (e) {
        return null;
    }
}

// Dynamic (not static) import of SillyTavern's own persona.js module,
// confirmed directly from its source code (pasted by the person using
// this extension): it exports `let user_avatar = ''`, described in its
// own JSDoc as "The currently selected persona (identified by its
// avatar)". This is a live ES module binding — it stays in sync with
// SillyTavern's internal state automatically, no re-fetching needed.
// Using a dynamic import() (not a static top-level import) so that if
// this path doesn't exist on some SillyTavern fork/version, it fails
// gracefully instead of breaking the whole extension.
let cachedPersonaModule = null;

async function getPersonaModule() {
    if (cachedPersonaModule !== null) return cachedPersonaModule || null;
    try {
        // NOTE: the real filename is "personas.js" (plural) — confirmed by
        // the person's own console log showing the source as
        // "personas.js:1627". An earlier attempt using the singular
        // "persona.js" 404'd.
        cachedPersonaModule = await import("../../../personas.js");
        console.log("[Comic Panel Generator] ✅ Successfully imported SillyTavern's persona.js module directly.");
    } catch (err) {
        console.warn("[Comic Panel Generator] Could not import persona.js directly (path may differ on this SillyTavern version/fork):", err);
        cachedPersonaModule = false;
    }
    return cachedPersonaModule || null;
}

async function tryAutoDetectPersonaAvatarFile() {
    // Attempt 0 (most authoritative — confirmed from ST's own source code):
    // read the live `user_avatar` export straight from persona.js.
    try {
        const mod = await getPersonaModule();
        if (mod && typeof mod.user_avatar === "string" && mod.user_avatar) {
            console.log(`[Comic Panel Generator] 🔎 Persona avatar detected via persona.js's own "user_avatar" export: ${mod.user_avatar}`);
            return mod.user_avatar;
        }
    } catch (err) {
        console.warn("[Comic Panel Generator] Reading user_avatar from persona.js failed:", err);
    }

    const context = getContext();

    // Attempt 1: a direct property on the context object, under either
    // common naming convention.
    const direct = context.user_avatar || context.userAvatar;
    if (direct && typeof direct === "string") {
        console.log(`[Comic Panel Generator] 🔎 Persona avatar auto-detected via context property: ${direct}`);
        return direct;
    }

    // Attempt 2: SillyTavern messages can carry a per-message "force_avatar"
    // when a persona is active — but per SillyTavern's own source
    // (syncUserNameToPersona: `mes.force_avatar = getThumbnailUrl('persona', user_avatar)`),
    // this is a full thumbnail URL/path, NOT a plain filename — extract just
    // the filename from it the same way we do for DOM-sourced URLs.
    const chat = context.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const mes = chat[i];
        if (mes && mes.is_user && mes.force_avatar && typeof mes.force_avatar === "string") {
            const extracted = extractAvatarFilenameFromUrl(mes.force_avatar) || mes.force_avatar;
            console.log(`[Comic Panel Generator] 🔎 Persona avatar auto-detected via last user message's force_avatar ("${mes.force_avatar}"): ${extracted}`);
            return extracted;
        }
    }

    // Attempt 3: read it straight from the DOM. Whatever the internal data
    // model looks like, if a user message is on screen at all, its avatar
    // <img> element must have a real, working src — this doesn't depend on
    // knowing any internal SillyTavern variable/field name, just on finding
    // the right element. Several selector variants are tried since the
    // exact markup can differ between SillyTavern versions/themes.
    const selectors = [
        '.mes[is_user="true"] .avatar img',
        '.mes[is_user="true"] img.avatar',
        '.mes[is_user="true"] .mesAvatarWrapper img',
        '#user_avatar_block img.selected',
    ];
    for (const sel of selectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
            const src = nodes[nodes.length - 1].getAttribute("src");
            const filename = src && extractAvatarFilenameFromUrl(src);
            if (filename) {
                console.log(`[Comic Panel Generator] 🔎 Persona avatar auto-detected via DOM (selector "${sel}"): ${filename}`);
                return filename;
            }
        }
    }

    // Attempt 4: SillyTavern's own console log ("Using default persona
    // X.png", from personas.js) confirms this filename exists somewhere in
    // its runtime state — but a console.log can't be read by an extension,
    // so this checks the two most common places small pieces of client-side
    // state like this get stashed, in case it's persisted there too.
    const filenamePattern = /^[\w.\-]+\.(png|jpe?g|webp)$/i;
    for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                const raw = storage.getItem(key);
                const value = raw ? raw.replace(/^"|"$/g, "") : "";
                if (filenamePattern.test(value)) {
                    const where = storage === window.localStorage ? "localStorage" : "sessionStorage";
                    console.log(`[Comic Panel Generator] 🔎 Persona avatar auto-detected via ${where} key "${key}": ${value}`);
                    return value;
                }
            }
        } catch (e) {
            // storage may be blocked/unavailable — ignore and move on
        }
    }

    console.log(`[Comic Panel Generator] 🔎 Could not auto-detect the persona avatar filename — falling back to the manual "Your persona avatar filename" field, if set.`);
    return null;
}

async function getPersonaAvatarEntry() {
    const s = settings();
    const filename = (await tryAutoDetectPersonaAvatarFile()) || (s.personaAvatarFile || "").trim();
    if (!filename) return null;

    const context = getContext();

    // Try the FULL-RESOLUTION original file first ("User Avatars/Name.png",
    // confirmed directly from SillyTavern's own persona.js source:
    // `getUserAvatar()` returns exactly this path), THEN fall back to the
    // thumbnail-generator endpoint (type=persona). The thumbnail endpoint
    // almost always succeeds (it just resizes/compresses the original), so
    // trying it FIRST — as this code used to — meant the full-resolution
    // original was never actually reached, likely explaining a difference
    // in img2img quality/style compared to uploading the original image
    // directly on NanoGPT's own site.
    const candidateUrls = [`${window.location.origin}/User%20Avatars/${encodeURIComponent(filename)}`];
    if (typeof context.getThumbnailUrl === "function") {
        const thumbPath = context.getThumbnailUrl("persona", filename);
        candidateUrls.push(thumbPath.startsWith("http") ? thumbPath : `${window.location.origin}${thumbPath}`);
    }
    candidateUrls.push(`${window.location.origin}/thumbnail?type=persona&file=${encodeURIComponent(filename)}`);

    for (const fullUrl of candidateUrls) {
        try {
            console.log(`[Comic Panel Generator] ✅ Trying full-res persona avatar from: ${fullUrl}`);
            const dataUrl = await blobUrlToDataUrl(fullUrl);
            return { label: "Persona (you)", url: dataUrl };
        } catch (err) {
            console.warn(`[Comic Panel Generator] ⚠️ Persona avatar not reachable at ${fullUrl}:`, err);
        }
    }

    console.warn(`[Comic Panel Generator] ⚠️ Persona avatar ("${filename}") could not be fetched as a reference via any known path.`);
    return null;
}

async function buildLabeledInputReferences(modelId) {
    const s = settings();
    const maxRefs = await getMaxReferencesForModel(modelId);
    const manualUrls = (s.referenceImages || []).map((r) => r.url).filter(Boolean).slice(0, maxRefs);

    let entries = [];
    for (let i = 0; i < manualUrls.length; i++) {
        const url = manualUrls[i];
        try {
            const resolvedUrl = await resolveManualReference(url);
            entries.push({ label: `Manual reference #${i + 1}`, url: resolvedUrl });
        } catch (err) {
            console.warn(`[Comic Panel Generator] ⚠️ Manual reference could not be loaded, excluded: ${url}`, err);
        }
    }
    console.log(`[Comic Panel Generator] Manual references used: ${entries.length}/${manualUrls.length} (model limit: ${maxRefs})`);

    if (entries.length < maxRefs) {
        const personaEntry = await getPersonaAvatarEntry();
        if (personaEntry) {
            entries.push(personaEntry);
        }
    }

    if (s.useCharacterAvatars && entries.length < maxRefs) {
        try {
            const avatarEntries = await getCharacterAvatarEntries(maxRefs - entries.length);
            entries = entries.concat(avatarEntries);
        } catch (err) {
            console.warn("[Comic Panel Generator] Failed to fetch character avatars:", err);
        }
    } else if (!s.useCharacterAvatars) {
        console.log("[Comic Panel Generator] Character avatars disabled in settings.");
    }

    entries = entries.slice(0, maxRefs);
    console.log(`[Comic Panel Generator] 🖼️ Total reference images sent to NanoGPT: ${entries.length}`, entries.map((e) => `${e.label}: ${e.url.slice(0, 50)}...`));
    return entries;
}

async function buildInputReferences(modelId) {
    const entries = await buildLabeledInputReferences(modelId);
    return entries.map((e) => e.url);
}

// ------------------------------------------------------------------
// Base references for a whole comic generation run. No reservation
// happens here anymore — the very first panel always gets the FULL set
// of available base references (character/persona/manual), never
// artificially reduced. The trade-off for the "last generated panel"
// reference (when enabled) is decided per-panel in the main generation
// loop instead, only once there's actually a previous panel to reference,
// and only if there isn't already free room for it.
// ------------------------------------------------------------------

async function buildBaseReferencesForGeneration(modelId) {
    const maxRefs = await getMaxReferencesForModel(modelId);
    const entries = await buildLabeledInputReferences(modelId); // already capped to maxRefs
    return { baseReferences: entries.map((e) => e.url), maxRefs };
}

// ------------------------------------------------------------------
// Visual verification: shows exactly which reference images would be
// sent for the NEXT generation, with a thumbnail and a label (character
// name / manual reference), without spending an actual generation.
// This exists so the person doesn't have to dig through DevTools to
// confirm the character/persona avatars are being picked up correctly.
// ------------------------------------------------------------------

async function onPreviewReferencesClick() {
    const s = settings();
    const container = document.getElementById("cpg_ref_preview");
    if (container) container.innerHTML = `<span style="font-size:0.8em; opacity:0.7;">Checking reference images...</span>`;
    setStatus("Checking reference images...");

    try {
        const entries = await buildLabeledInputReferences(s.model);

        if (!container) return;

        if (entries.length === 0) {
            container.innerHTML = `<span style="font-size:0.8em; opacity:0.8;">
                ⚠️ No reference image would be used for the next generation. If you expected some:
                make sure "Use character avatars as reference" is on and that a character has
                spoken recently in chat, or add a manual reference URL above.
            </span>`;
            setStatus("⚠️ No reference image found.");
            return;
        }

        container.innerHTML = entries
            .map(
                (e) => `
            <div class="cpg-ref-preview-item">
                <img src="${e.url}" alt="${escapeHtml(e.label)}" />
                <span>${escapeHtml(e.label)}</span>
            </div>`
            )
            .join("");

        setStatus(`✅ ${entries.length} reference image(s) would be used — check above that they're the right ones.`);
    } catch (err) {
        console.error("[Comic Panel Generator] Reference preview failed:", err);
        if (container) container.innerHTML = `<span style="font-size:0.8em; color:#ff8080;">Error while checking references (see console).</span>`;
        setStatus("Error while checking references: " + (err.message || err));
    }
}

// ------------------------------------------------------------------
// NanoGPT API call for image generation.
// Uses the "normalized" endpoint /api/v1/images when reference images
// are present (supports input_references), otherwise the OpenAI-compatible
// endpoint configured in settings.
// Doc: https://docs.nano-gpt.com/api-reference/image-generation
// ------------------------------------------------------------------

// Fallback resolution list, used only when a model's own metadata doesn't
// declare its supported resolutions (verified directly for Qwen Image;
// used as a generic fallback for other "structured-format" models too).
const FALLBACK_STRUCTURED_RESOLUTIONS = ["auto", "1024x1024", "512x512", "768x1024", "576x1024", "1024x768", "1024x576"];

// Maps each resolution NanoGPT documents for Qwen Image (and shares as a
// fallback for other "structured" models) to the aspect_ratio string their
// own request examples always include alongside it — same aspect labels
// NanoGPT itself uses ("Portrait (3:4)", "Landscape (16:9)"...).
const STRUCTURED_RESOLUTION_ASPECTS = {
    "auto": "1:1",
    "1024x1024": "1:1",
    "512x512": "1:1",
    "768x1024": "3:4",
    "576x1024": "9:16",
    "1024x768": "4:3",
    "1024x576": "16:9",
};


// ====================================================================
// GENERIC PROVIDER SYSTEM
// ====================================================================
// Lets the person point this extension at ANY image-generation HTTP API
// (a different hosted service, or a local one like Fooocus-API) instead
// of NanoGPT, by filling in a request template rather than hardcoding
// one specific API's shape. This is deliberately kept to simple
// synchronous request -> response APIs (send JSON, get the image back in
// the same response) — job-based/polling APIs are NOT supported by this
// first version.
// ====================================================================

/**
 * Substitutes {{placeholders}} inside a JSON body template with real
 * values, JSON-escaping strings safely and inserting numbers/arrays raw
 * (since the template already omits quotes around those). The template
 * itself must be valid JSON once all placeholders are filled in — no
 * JSON.parse/stringify round-trip is done, the substituted string is sent
 * as-is, so whitespace/formatting the person wrote is preserved exactly.
 * @param {string} templateStr
 * @param {Object<string, any>} values
 * @returns {string}
 */
function applyProviderTemplate(templateStr, values) {
    let result = templateStr;
    for (const [key, val] of Object.entries(values)) {
        const token = `{{${key}}}`;
        if (!result.includes(token)) continue;
        const raw = typeof val === "string" ? JSON.stringify(val).slice(1, -1) : JSON.stringify(val);
        result = result.split(token).join(raw);
    }
    return result;
}

/**
 * Resolves a simple dot/bracket path like "data[0].url" or "images.0.b64"
 * against a parsed JSON response object.
 * @param {any} obj
 * @param {string} path
 * @returns {any}
 */
function getByResponsePath(obj, path) {
    if (!path) return undefined;
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function getActiveCustomProvider(s) {
    if (!s || s.activeProviderId === "nanogpt") return null;
    return (s.customProviders || []).find((p) => p.id === s.activeProviderId) || null;
}

// Display name of whichever provider is currently active — used in every
// user-facing message so the UI never hardcodes "NanoGPT" when a custom
// provider might actually be the one in use.
function getActiveProviderDisplayName() {
    const s = settings();
    const customProvider = getActiveCustomProvider(s);
    return customProvider ? customProvider.name : "NanoGPT";
}

// Best-effort starting template for Fooocus-API (community project, NOT
// part of Fooocus itself) in SYNCHRONOUS mode ("async_process": false).
// Based on the project's generally documented schema — NOT verified live
// by this extension. Fooocus-API auto-generates interactive docs for your
// own running instance at http://127.0.0.1:8888/docs — check those for
// the exact, guaranteed-correct field names/values for your version
// before relying on this, and adjust the template here to match.
const FOOOCUS_API_TEMPLATE = {
    name: "Fooocus-API (local, sync mode) — unverified starting point",
    endpoint: "http://127.0.0.1:8888/v1/generation/text-to-image",
    noAuth: true,
    apiKey: "",
    bodyTemplate: JSON.stringify(
        {
            prompt: "{{prompt}}",
            negative_prompt: "{{negative_prompt}}",
            style_selections: ["Fooocus V2", "Fooocus Enhance"],
            performance_selection: "Speed",
            aspect_ratios_selection: "1024*1024",
            image_number: 1,
            image_seed: -1,
            guidance_scale: "{{cfg}}",
            sharpness: 2,
            async_process: false,
            input_image_checkbox: "{{has_references}}",
            uov_input_image: "{{first_reference_base64}}",
        },
        null,
        2
    ),
    responseImagePath: "[0].base64",
    responseType: "base64",
    supportsReferences: true,
};

async function generateImage(prompt, references, negativePromptOverride) {
    const s = settings();
    const customProvider = getActiveCustomProvider(s);
    if (customProvider) {
        return await generateImageViaCustomProvider(prompt, references, negativePromptOverride, customProvider);
    }
    return await generateImageViaNanoGPT(prompt, references, negativePromptOverride);
}

// ------------------------------------------------------------------
// Generic custom-provider request: builds the request from the
// person's own template, sends it, and extracts the image via the
// configured response path. Synchronous request/response APIs only.
// ------------------------------------------------------------------

async function generateImageViaCustomProvider(prompt, references, negativePromptOverride, provider) {
    const s = settings();
    const negativePrompt = negativePromptOverride !== undefined ? negativePromptOverride : buildNegativePrompt();
    // No NanoGPT-based defaults available for a custom provider — use a
    // generic fallback unless the person has already customized Steps/CFG
    // for THIS provider specifically (keyed by provider.id, not s.model).
    const savedParams = s.perModelGenerationParams?.[provider.id];
    const steps = typeof savedParams?.steps === "number" ? savedParams.steps : QWEN_INFERENCE_STEPS;
    const cfg = typeof savedParams?.cfg === "number" ? savedParams.cfg : QWEN_GUIDANCE_SCALE;
    const [width, height] = (s.imageSize || "1024x1024").split("x").map((n) => parseInt(n, 10) || 1024);
    const hasRefs = Array.isArray(references) && references.length > 0;

    const values = {
        prompt: prompt || "",
        negative_prompt: negativePrompt || "",
        steps,
        cfg,
        width,
        height,
        seed: -1,
        n: 1,
        nsfw: !!s.nsfw,
        has_references: hasRefs,
        images_json: hasRefs ? references : [],
        first_reference_base64: hasRefs ? references[0] : "",
    };

    let bodyStr;
    try {
        bodyStr = applyProviderTemplate(provider.bodyTemplate || "{}", values);
        JSON.parse(bodyStr); // validate it's still well-formed JSON after substitution
    } catch (err) {
        throw new Error(`Custom provider "${provider.name}": body template is not valid JSON after filling in placeholders (${err.message}). Check the template in settings.`);
    }

    const headers = { "Content-Type": "application/json" };
    if (!provider.noAuth && provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
        headers["x-api-key"] = provider.apiKey;
    }

    console.log(`[Comic Panel Generator] → POST ${provider.endpoint} (custom provider "${provider.name}") | references: ${hasRefs ? references.length : 0}`);

    const response = await fetch(provider.endpoint, { method: "POST", headers, body: bodyStr });
    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`${provider.name} API ${response.status}: ${errText || response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Comic Panel Generator] ← ${provider.name} response:`, data);

    const raw = getByResponsePath(data, provider.responseImagePath);
    if (!raw) {
        throw new Error(
            `Custom provider "${provider.name}": no value found at response path "${provider.responseImagePath}". ` +
            `Response was: ${JSON.stringify(data).slice(0, 300)}`
        );
    }

    if (provider.responseType === "base64") {
        const alreadyDataUrl = typeof raw === "string" && raw.startsWith("data:");
        return alreadyDataUrl ? raw : `data:image/png;base64,${raw}`;
    }
    return raw; // treated as a URL
}

async function generateImageViaNanoGPT(prompt, references, negativePromptOverride) {
    const s = settings();
    const hasRefs = Array.isArray(references) && references.length > 0;
    const negativePrompt = negativePromptOverride !== undefined ? negativePromptOverride : buildNegativePrompt();
    const useStructured = await usesStructuredGenerationFormat(s.model);

    // Last-resort safety net: whatever path built this prompt, never send
    // more than NanoGPT's general limit (with margin) — but some models
    // enforce a much stricter limit of their own (e.g. "Qwen Image 3" caps
    // at 800 characters instead of NanoGPT's usual ~3000). If we've already
    // learned this model's real limit from a previous API error (see the
    // retry logic below), use that instead.
    const learnedLimit = modelPromptCharLimitCache[s.model];
    const effectiveMaxChars = typeof learnedLimit === "number" ? Math.min(learnedLimit, MAX_PROMPT_CHARS) : MAX_PROMPT_CHARS;
    let safePrompt = prompt;
    if (safePrompt && safePrompt.length > effectiveMaxChars) {
        console.warn(`[Comic Panel Generator] ⚠️ Prompt too long for "${s.model}" (${safePrompt.length} chars, limit ${effectiveMaxChars}), truncating before sending.`);
        safePrompt = truncateForPrompt(safePrompt, effectiveMaxChars);
    }

    let url, body;

    if (useStructured) {
        // ---- "Structured" NanoGPT models (Qwen Image, WAI Illustrious SDXL,
        // and any other model NanoGPT exposes the same way) ----
        // Verified directly against NanoGPT's own "export as API" feature for
        // Qwen Image (pasted twice, identical both times), and detected
        // generically here (rather than hardcoded to one model name) by
        // checking whether the model's own declared parameters include
        // imageDataUrl(s)/nImages. Uses this model's own Steps/CFG Scale
        // default+range (read from NanoGPT, not hardcoded), with any value
        // the person has customized for THIS specific model taking priority.
        url = "https://nano-gpt.com/api/v1/images/generations";

        const endpoint = await fetchModelEndpointMetadata(s.model);
        const resolutionOptions = endpoint?.supported_parameters?.resolution?.options;
        const validResolutions = Array.isArray(resolutionOptions) && resolutionOptions.length > 0
            ? resolutionOptions.map((o) => o.value)
            : FALLBACK_STRUCTURED_RESOLUTIONS;
        const resolution = validResolutions.includes(s.imageSize) ? s.imageSize : "auto";

        const paramDefaults = await getGenerationParamDefaults(s.model);
        const savedParams = s.perModelGenerationParams?.[s.model];
        const steps = typeof savedParams?.steps === "number" ? savedParams.steps : paramDefaults.steps.default;
        const cfg = typeof savedParams?.cfg === "number" ? savedParams.cfg : paramDefaults.cfg.default;

        // aspect_ratio: present in every verified request example from
        // NanoGPT's own site but absent from the documented
        // supported_parameters — likely needed to fully pin down the output
        // shape (especially when resolution is "auto"), matching the same
        // resolution options NanoGPT itself documents with these exact
        // aspect labels ("Portrait (3:4)", "Landscape (16:9)", etc.).
        const aspectRatio = STRUCTURED_RESOLUTION_ASPECTS[resolution] || "1:1";

        body = {
            model: s.model,
            prompt: safePrompt,
            negative_prompt: negativePrompt || "",
            resolution,
            resolutionExplicit: true,
            aspect_ratio: aspectRatio,
            nImages: 1,
            guidance_scale: cfg,
            num_inference_steps: steps,
            // Native NSFW handling for this route, instead of relying on
            // stuffing "NSFW" into the prompt/negative_prompt as free text.
            showExplicitContent: !!s.nsfw,
            enable_safety_checker: !s.nsfw,
            // Present in every verified NanoGPT request example for this
            // route (regardless of model) — likely generic scaffolding
            // fields their frontend always sends. Included for parity;
            // wan27_has_reference_images reflects whether we're actually
            // attaching reference images this time.
            wan27_has_video_input: false,
            wan27_has_reference_images: hasRefs,
        };
        if (hasRefs) {
            // Up to the model's own declared max — see input_reference_constraints.
            body.imageDataUrls = references;
        }
    } else {
        // ---- Every other model: unchanged from before ----
        url = hasRefs ? NANOGPT_IMAGES_NORMALIZED_ENDPOINT : (s.apiEndpoint || defaultSettings.apiEndpoint);
        body = hasRefs
            ? {
                  model: s.model || defaultSettings.model,
                  prompt: safePrompt,
                  input_references: references,
                  resolution: s.imageSize || "1024x1024",
                  quality: "medium",
                  n: 1,
              }
            : {
                  model: s.model || defaultSettings.model,
                  prompt: safePrompt,
                  size: s.imageSize || "1024x1024",
                  response_format: "url",
                  n: 1,
              };
        // negative_prompt is a "model-specific" parameter per NanoGPT docs
        // (not in the list of guaranteed common fields): we include it
        // anyway, models that don't support it should simply ignore it.
        if (negativePrompt) {
            body.negative_prompt = negativePrompt;
        }
    }

    console.log(
        `[Comic Panel Generator] → POST ${url} | model: ${body.model} | references: ${hasRefs ? references.length : 0}\n` +
        `  prompt: ${body.prompt}\n` +
        `  negative_prompt: ${negativePrompt || "(none)"}` +
        (useStructured ? `\n  structured format: CFG ${body.guidance_scale}, ${body.num_inference_steps} steps, resolution ${body.resolution}, aspect_ratio ${body.aspect_ratio}` : "\n  (generic/legacy format — no CFG/steps/aspect_ratio sent on this route)")
    );
    if (hasRefs) {
        // Explicit, separate log of the exact reference images actually
        // being sent in THIS request body — not just a count — so it can
        // be directly compared against what the "Preview reference images"
        // button showed.
        const sentRefs = useStructured ? body.imageDataUrls : body.input_references;
        console.log(
            `[Comic Panel Generator] 📤 reference images actually sent in this request (field: ${useStructured ? "imageDataUrls" : "input_references"}):`,
            (sentRefs || []).map((r) => (typeof r === "string" ? r.slice(0, 60) + "..." : r))
        );
        // Decode each reference's REAL pixel dimensions locally, straight out
        // of its own file header — not trusting anything a server says about
        // it. This exists specifically to check whether NanoGPT's own
        // "image too large" error (which reported a nonsense size,
        // 65536x4292542531 — suspiciously close to a 32-bit integer
        // overflow) reflects an actually-oversized/malformed image on our
        // end, or looks like a bug in their own error reporting instead.
        (sentRefs || []).forEach((r, i) => {
            if (typeof r === "string" && r.startsWith("data:")) {
                const dims = decodeImageDimensionsFromDataUrl(r);
                console.log(`[Comic Panel Generator] 📐 reference #${i + 1} real decoded size: ${dims.width ?? "?"}x${dims.height ?? "?"} (${dims.format}${dims.note ? ", " + dims.note : ""}${dims.error ? ", error: " + dims.error : ""})`);
            } else {
                console.log(`[Comic Panel Generator] 📐 reference #${i + 1} is a plain URL, not a data URL — can't decode its size locally without fetching it.`);
            }
        });
    }

    // Send both auth header styles: the verified Qwen spec uses "x-api-key",
    // the rest of this extension was built against "Authorization: Bearer".
    // Sending both is harmless and removes any ambiguity about which one a
    // given route actually expects.
    async function doFetch() {
        return fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${s.apiKey}`,
                "x-api-key": s.apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
    }

    let response = await doFetch();

    if (!response.ok) {
        let errText = await response.text().catch(() => "");

        // If the model rejected the prompt as too long, NanoGPT's error
        // message conveniently includes the model's actual limit (e.g.
        // "Please shorten it to 800 characters or less"). Parse it, learn
        // it for this model going forward, and retry once with a prompt
        // that actually fits — instead of failing the whole panel.
        const lengthMatch = errText.match(/shorten it to ([\d,]+) characters/i);
        if (response.status === 400 && lengthMatch) {
            const realLimit = parseInt(lengthMatch[1].replace(/,/g, ""), 10);
            if (!isNaN(realLimit) && realLimit > 0 && body.prompt && body.prompt.length > realLimit) {
                modelPromptCharLimitCache[s.model] = realLimit;
                console.warn(
                    `[Comic Panel Generator] ⚠️ "${s.model}" enforces a stricter prompt limit than assumed ` +
                    `(${realLimit} chars, we had truncated to ${effectiveMaxChars}). Retrying once with a shorter prompt — ` +
                    `this limit is now remembered for this model.`
                );
                body.prompt = truncateForPrompt(body.prompt, Math.max(50, realLimit - 10));
                response = await doFetch();
                if (!response.ok) {
                    errText = await response.text().catch(() => "");
                }
            }
        }

        // "Image too large" with a nonsense reported size (e.g.
        // "65536x4292542531") turned out, in testing, to happen even when
        // every reference's own locally-decoded dimensions were completely
        // normal — pointing to something about a specific reference file
        // (most likely the "reuse last panel" one) confusing NanoGPT's
        // parser, not an actual oversized image. If cleaning/re-encoding
        // that reference didn't already prevent it, retry once by simply
        // dropping the LAST reference in the array (the most likely
        // culprit, and the lowest-priority one) rather than failing the
        // whole panel outright.
        const isImageTooLarge = response.status === 413 || /IMAGE_INPUT_TOO_LARGE/i.test(errText);
        if (!response.ok && isImageTooLarge && Array.isArray(body.imageDataUrls) && body.imageDataUrls.length > 0) {
            console.warn(
                `[Comic Panel Generator] ⚠️ NanoGPT rejected a reference image as "too large" (often a false positive — see Console for the locally-decoded real dimensions logged earlier). ` +
                `Retrying once with the last reference image dropped instead of failing this panel:`,
                errText
            );
            body.imageDataUrls = body.imageDataUrls.slice(0, -1);
            if (body.imageDataUrls.length === 0) delete body.imageDataUrls;
            response = await doFetch();
            if (!response.ok) {
                errText = await response.text().catch(() => "");
            }
        }

        // Transient server-side errors (504 Gateway Timeout, 503 Service
        // Unavailable, or an explicit "timeout" error code) are not caused
        // by anything in the request — NanoGPT's own error message even
        // confirms no charge was made for a timed-out request. These are
        // usually worth one automatic retry after a short pause, instead of
        // failing the whole panel over a transient blip.
        const isTransientError =
            response.status === 504 ||
            response.status === 503 ||
            /timeout/i.test(errText);
        if (!response.ok && isTransientError) {
            console.warn(`[Comic Panel Generator] ⚠️ Transient error from NanoGPT (${response.status}), retrying once after a short pause:`, errText);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            response = await doFetch();
            if (!response.ok) {
                errText = await response.text().catch(() => "");
            }
        }

        if (!response.ok) {
            throw new Error(`NanoGPT API ${response.status}: ${errText || response.statusText}`);
        }
    }

    const data = await response.json();
    console.log("[Comic Panel Generator] ← NanoGPT response:", data);

    // Defensive extraction: try the OpenAI-style shape first (used
    // elsewhere in this extension), then a couple of plausible
    // alternatives in case this specific route responds differently.
    const first = data?.data?.[0] || data?.images?.[0] || data?.output?.[0];
    const outUrl =
        first?.url ||
        (typeof first === "string" ? first : null) ||
        (first?.b64_json && `data:image/png;base64,${first.b64_json}`) ||
        data?.url ||
        null;

    if (!outUrl) {
        throw new Error("API response had no valid image URL: " + JSON.stringify(data).slice(0, 300));
    }

    // Sanity check: a real image URL/data URL should look like one. If it's
    // suspiciously short or doesn't start with http(s)/data:, something
    // about the response shape probably wasn't what this extraction logic
    // expected — better to fail loudly here than pass along something odd
    // that could cause a confusing downstream error (e.g. NanoGPT rejecting
    // it as an "input image" with a nonsense size on a later panel that
    // reuses it as a reference).
    const looksValid = typeof outUrl === "string" && (outUrl.startsWith("http") || outUrl.startsWith("data:")) && outUrl.length > 15;
    if (!looksValid) {
        console.warn("[Comic Panel Generator] ⚠️ Extracted image value doesn't look like a real URL/data URL:", outUrl, "| full response:", data);
        throw new Error(`API response image value looks invalid ("${String(outUrl).slice(0, 80)}"): ` + JSON.stringify(data).slice(0, 300));
    }

    return outUrl;
}

// ------------------------------------------------------------------
// Discover available image models on NanoGPT
// GET https://nano-gpt.com/api/v1/image-models?detailed=true
// ------------------------------------------------------------------

let cachedImageModels = [];

async function fetchAvailableModels() {
    const s = settings();
    const headers = { "Content-Type": "application/json" };
    if (s.apiKey) headers["Authorization"] = `Bearer ${s.apiKey}`;

    const response = await fetch(NANOGPT_MODELS_ENDPOINT, { method: "GET", headers });
    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Error fetching models (${response.status}): ${errText || response.statusText}`);
    }
    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    return models.filter((m) => m?.capabilities?.image_generation !== false);
}

function formatModelLabel(model) {
    const name = model.name || model.id;
    let priceLabel = "";
    try {
        const perImage = model?.pricing?.per_image;
        if (perImage && typeof perImage === "object") {
            const firstKey = Object.keys(perImage)[0];
            if (firstKey) priceLabel = ` — $${perImage[firstKey]}/img`;
        }
    } catch (e) { /* pricing is optional */ }
    return `${name} (${model.id})${priceLabel}`;
}

async function onLoadModelsClick() {
    setStatus("Loading model list from NanoGPT...");
    try {
        cachedImageModels = await fetchAvailableModels();
        const select = document.getElementById("cpg_model_list");
        select.innerHTML = "";

        if (cachedImageModels.length === 0) {
            select.innerHTML = `<option value="">No models found</option>`;
            setStatus("No image models found in the API response.");
            return;
        }

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = `-- ${cachedImageModels.length} models found, pick one --`;
        select.appendChild(placeholder);

        const sorted = [...cachedImageModels].sort((a, b) => {
            const aQwen = /qwen/i.test(a.id) || /qwen/i.test(a.name || "") ? 0 : 1;
            const bQwen = /qwen/i.test(b.id) || /qwen/i.test(b.name || "") ? 0 : 1;
            if (aQwen !== bQwen) return aQwen - bQwen;
            return (a.name || a.id).localeCompare(b.name || b.id);
        });

        for (const model of sorted) {
            const opt = document.createElement("option");
            opt.value = model.id;
            opt.textContent = formatModelLabel(model);
            if (model.id === settings().model) opt.selected = true;
            select.appendChild(opt);
        }

        setStatus(`Loaded ${cachedImageModels.length} models. Select the one you want to use.`);
        notify("success", "Model list refreshed from NanoGPT.");

        if (cachedImageModels.some((m) => m.id === settings().model)) {
            applyResolutionsForModel(settings().model);
        }
    } catch (err) {
        console.error("[Comic Panel Generator] Error loading models:", err);
        setStatus("Error loading models: " + (err.message || err));
        notify("error", "Could not load the model list (see console / documentation).");
    }
}

function applyResolutionsForModel(modelId) {
    const model = cachedImageModels.find((m) => m.id === modelId);
    const sizeSelect = document.getElementById("cpg_size");
    if (!model || !sizeSelect) return;

    const resolutions = model?.supported_parameters?.resolutions;
    if (!Array.isArray(resolutions) || resolutions.length === 0) return;

    const s = settings();
    sizeSelect.innerHTML = "";
    for (const res of resolutions) {
        const opt = document.createElement("option");
        opt.value = res;
        opt.textContent = res;
        sizeSelect.appendChild(opt);
    }

    if (resolutions.includes(s.imageSize)) {
        sizeSelect.value = s.imageSize;
    } else {
        sizeSelect.value = resolutions[0];
        s.imageSize = resolutions[0];
        saveSettingsDebounced();
    }
}

// Populates the Steps/CFG Scale fields for whichever model is selected:
// uses this specific model's already-saved values if the person customized
// them before, otherwise falls back to the model's own declared default —
// read from NanoGPT itself (GET /api/v1/images/models/{id}/endpoints),
// never a single hardcoded value shared across every model.
async function applyGenerationParamsForModelUI(modelId) {
    if (!modelId) return;
    const s = settings();
    const stepsInput = document.getElementById("cpg_steps");
    const cfgInput = document.getElementById("cpg_cfg");
    if (!stepsInput || !cfgInput) return;

    let defaults;
    try {
        defaults = await getGenerationParamDefaults(modelId);
    } catch (err) {
        console.warn(`[Comic Panel Generator] Could not read Steps/CFG defaults for "${modelId}":`, err);
        return;
    }

    const saved = s.perModelGenerationParams?.[modelId];
    const steps = typeof saved?.steps === "number" ? saved.steps : defaults.steps.default;
    const cfg = typeof saved?.cfg === "number" ? saved.cfg : defaults.cfg.default;

    stepsInput.min = defaults.steps.min;
    stepsInput.max = defaults.steps.max;
    stepsInput.value = steps;

    cfgInput.min = defaults.cfg.min;
    cfgInput.max = defaults.cfg.max;
    cfgInput.step = defaults.cfg.step;
    cfgInput.value = cfg;

    if (!s.perModelGenerationParams) s.perModelGenerationParams = {};
    if (!s.perModelGenerationParams[modelId]) {
        s.perModelGenerationParams[modelId] = { steps, cfg };
        saveSettingsDebounced();
    }

    console.log(`[Comic Panel Generator] Steps/CFG for "${modelId}": ${steps} steps, CFG ${cfg} (range ${defaults.steps.min}-${defaults.steps.max} / ${defaults.cfg.min}-${defaults.cfg.max}).`);
}

// ------------------------------------------------------------------
// Comic rendering: grid of divs + speech balloons
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Prompt review screen: shows the exact, final prompt for every panel
// (after translation, with style/negative prompt included) in editable
// boxes, before any image gets generated. Returns a Promise resolving to
// either { confirmed: true, promptInfos, negativePrompt } with any edits
// applied, or { confirmed: false } if the person cancels.
// ------------------------------------------------------------------

function openPromptReviewOverlay(panels, promptInfos, defaultNegativePrompt) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "cpg-overlay";
        overlay.id = "cpg_review_overlay";

        const panelsHtml = promptInfos
            .map((info, i) => {
                const badge =
                    info.translationInfo && !info.translationInfo.applied
                        ? `<span class="cpg-review-badge" title="${escapeHtml(info.translationInfo.reason)}">⚠️ not translated</span>`
                        : "";
                return `
                <div class="cpg-review-panel">
                    <label>Panel ${i + 1} prompt ${badge}</label>
                    <textarea class="cpg-review-textarea" data-panel-index="${i}">${escapeHtml(info.prompt)}</textarea>
                </div>`;
            })
            .join("");

        overlay.innerHTML = `
            <div class="cpg-modal">
                <div class="cpg-modal-header">
                    <h3>🔍 Review prompts before generating</h3>
                    <span class="cpg-close-btn" id="cpg_review_close_btn">✖</span>
                </div>
                <p style="font-size:0.8em; opacity:0.8; margin-top:0;">
                    This is the exact text that will be sent to ${escapeHtml(getActiveProviderDisplayName())} for each panel. Edit anything you want,
                    then confirm — or cancel to abort without generating anything.
                </p>
                <div class="cpg-review-panel">
                    <label>Negative prompt (shared across all panels)</label>
                    <textarea class="cpg-review-textarea" id="cpg_review_negative">${escapeHtml(defaultNegativePrompt)}</textarea>
                </div>
                ${panelsHtml}
                <div class="cpg-buttons">
                    <button id="cpg_review_confirm_btn" class="menu_button">✅ Generate comic</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        document.getElementById("cpg_review_close_btn").addEventListener("click", () => cleanup({ confirmed: false }));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) cleanup({ confirmed: false });
        });

        document.getElementById("cpg_review_confirm_btn").addEventListener("click", () => {
            const editedNegativePrompt = document.getElementById("cpg_review_negative").value;
            const editedInfos = promptInfos.map((info, i) => {
                const textarea = overlay.querySelector(`.cpg-review-textarea[data-panel-index="${i}"]`);
                return { ...info, prompt: textarea ? textarea.value : info.prompt };
            });
            cleanup({ confirmed: true, promptInfos: editedInfos, negativePrompt: editedNegativePrompt });
        });
    });
}

function openOverlay(numPanels, comicStyle) {
    const overlay = document.createElement("div");
    overlay.className = "cpg-overlay";
    overlay.id = "cpg_overlay";

    const columns = numPanels <= 1 ? 1 : Math.min(3, Math.max(2, Math.ceil(Math.sqrt(numPanels))));

    overlay.innerHTML = `
        <div class="cpg-modal cpg-style-${comicStyle}">
            <div class="cpg-modal-header">
                <h3>🎬 Comic generated</h3>
                <span class="cpg-close-btn" id="cpg_close_btn">✖</span>
            </div>
            <div class="cpg-page" id="cpg_page">
                <div class="cpg-grid" id="cpg_grid" style="grid-template-columns: repeat(${columns}, 1fr);"></div>
            </div>
            <div class="cpg-buttons">
                <button id="cpg_insert_now_btn" class="menu_button" disabled title="Available once all panels have finished generating">📩 Insert</button>
                <button id="cpg_export_btn" class="menu_button" disabled title="Available once all panels have finished generating">💾 Export</button>
                <div id="cpg_ref_summary" class="cpg-ref-summary"></div>
            </div>
            <div id="cpg_export_status" class="cpg-status"></div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById("cpg_close_btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });

    return document.getElementById("cpg_grid");
}

function addLoadingPanel(grid, index) {
    const panel = document.createElement("div");
    panel.className = "cpg-panel cpg-loading";
    panel.id = `cpg_panel_${index}`;
    panel.style.setProperty("--cpg-tilt", `${(index % 2 === 0 ? -1 : 1) * (0.6 + (index % 3) * 0.3)}deg`);
    panel.textContent = `Generating panel ${index + 1}...`;
    grid.appendChild(panel);
    return panel;
}

// Starting positions (as % of the panel) for up to 4 balloons, still
// biased toward the corners as a safe generic default — but now these
// are just a STARTING point: the person can drag every balloon anywhere
// on the panel afterward, in the "Comic generated" preview, before
// confirming. Default tail angles point roughly toward the panel center
// from each corner (0deg = pointing straight down, clockwise positive).
const BUBBLE_START_POSITIONS = [
    { left: 3, top: 3, tailDeg: 45 }, // top-left, tail toward bottom-right
    { left: 55, top: 3, tailDeg: -45 }, // top-right, tail toward bottom-left
    { left: 3, top: 55, tailDeg: 135 }, // bottom-left, tail toward top-right
    { left: 55, top: 55, tailDeg: -135 }, // bottom-right, tail toward top-left
];

function buildBubblesHtml(dialogue) {
    if (!dialogue || dialogue.length === 0) return "";
    return dialogue
        .map((d, i) => {
            const pos = BUBBLE_START_POSITIONS[i % BUBBLE_START_POSITIONS.length];
            const isThought = d.type === "thought";
            const typeClass = isThought ? "cpg-bubble-thought" : "cpg-bubble-speech";
            // The speaker name is a separate tag OUTSIDE the text content
            // (not inside .cpg-bubble-content) specifically so hiding it for
            // export never reflows/resizes the actual dialogue text — what
            // you see while editing (name shown) is exactly what you get in
            // the exported image (name hidden), just minus the tag itself.
            // It also doubles as a grab handle for moving the balloon.
            const speaker = d.speaker
                ? `<span class="cpg-bubble-speaker" title="Drag to move this balloon">${escapeHtml(d.speaker)}</span>`
                : "";
            const tail = isThought
                ? ""
                : `<div class="cpg-bubble-tail-wrap" style="transform: rotate(${pos.tailDeg}deg);" data-angle="${pos.tailDeg}" title="Drag to point this balloon toward the speaker">
                       <div class="cpg-bubble-tail-outline"></div>
                       <div class="cpg-bubble-tail-fill"></div>
                   </div>`;
            return `<div class="cpg-bubble ${typeClass}" style="left:${pos.left}%; top:${pos.top}%;">
                        ${speaker}
                        <div class="cpg-bubble-content">${escapeHtml(d.text)}</div>
                        ${tail}
                    </div>`;
        })
        .join("");
}

// ------------------------------------------------------------------
// Manual balloon positioning: drag to move, drag the tail to redirect
// it. Works directly on the live DOM, so "Insert into chat" and
// "Export as single image" — which both capture whatever is currently
// on screen — automatically pick up wherever the balloons were left.
// ------------------------------------------------------------------

// Computes where the tail should attach on the bubble's own edge for a
// given angle (0deg = down, clockwise-positive — same convention as the
// rotation), approximating the bubble's shape as an ellipse matching its
// actual rendered width/height. This is what makes the tail "slide"
// around the balloon's perimeter as its direction changes, instead of
// staying pinned to one fixed spot while only rotating in place.
function updateTailAnchor(bubble, tailWrap, angleDeg) {
    const halfW = bubble.offsetWidth / 2;
    const halfH = bubble.offsetHeight / 2;
    if (!halfW || !halfH) return;

    const rad = (angleDeg * Math.PI) / 180;
    const dx = -Math.sin(rad);
    const dy = Math.cos(rad);
    const denom = Math.sqrt((dx / halfW) ** 2 + (dy / halfH) ** 2) || 1;
    const t = 1 / denom;

    // Pull the anchor slightly IN from the exact ellipse edge so the base
    // of the tail overlaps into the balloon a bit, instead of floating
    // just outside its border — reads as more firmly "attached", while
    // still leaving most of the tail exposed and easy to grab/drag.
    const pull = 0.85;
    const anchorX = halfW + t * dx * pull;
    const anchorY = halfH + t * dy * pull;

    tailWrap.style.left = `${anchorX}px`;
    tailWrap.style.top = `${anchorY}px`;
    tailWrap.style.transform = `rotate(${angleDeg}deg)`;
    tailWrap.setAttribute("data-angle", angleDeg.toFixed(1));
}

function initSingleBubble(panelEl, bubble) {
    const tailWrap = bubble.querySelector(".cpg-bubble-tail-wrap");
    const content = bubble.querySelector(".cpg-bubble-content");

    // Lock in an EXPLICIT pixel width/height as soon as the balloon has
    // its actual rendered size. Without this, an absolutely positioned
    // element with only `left` set (no explicit width) gets its
    // "shrink-to-fit" width recalculated based on how much space is
    // left between its position and the container's edge — so simply
    // dragging it toward the center/far edge silently changes how much
    // room it has, reflowing the text into a different shape. Locking
    // an explicit width/height decouples sizing from position entirely.
    const rect = bubble.getBoundingClientRect();
    if (rect.width > 0 && !bubble.style.width) {
        bubble.style.width = `${rect.width}px`;
        bubble.style.height = `${rect.height}px`;
        bubble.style.maxWidth = "none";
    }

    // Set the correct starting anchor position now that the bubble has
    // an actual rendered size (impossible to know at HTML-string time).
    if (tailWrap) {
        const initialAngle = parseFloat(tailWrap.getAttribute("data-angle")) || 0;
        updateTailAnchor(bubble, tailWrap, initialAngle);
    }

    // --- Double-click the text to edit it in place ---
    if (content) {
        content.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            content.contentEditable = "true";
            bubble.dataset.editing = "true";
            content.focus();
            const range = document.createRange();
            range.selectNodeContents(content);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
        content.addEventListener("blur", () => {
            content.contentEditable = "false";
            delete bubble.dataset.editing;
        });
        content.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                content.blur();
            }
        });
    }

    // --- Red X: delete this balloon ---
    const deleteBtn = document.createElement("span");
    deleteBtn.className = "cpg-bubble-delete";
    deleteBtn.title = "Delete this balloon";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        bubble.remove();
    });
    bubble.appendChild(deleteBtn);

    // --- Resize handle (bottom-right corner) ---
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "cpg-bubble-resize-handle";
    resizeHandle.title = "Drag to resize this balloon";
    bubble.appendChild(resizeHandle);
    resizeHandle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = bubble.offsetWidth;
        const startHeight = bubble.offsetHeight;
        const panelRect = panelEl.getBoundingClientRect();
        const minSize = 40;
        const maxWidth = panelRect.width * 0.9;
        const maxHeight = panelRect.height * 0.9;

        function onMove(ev) {
            const newWidth = Math.min(maxWidth, Math.max(minSize, startWidth + (ev.clientX - startX)));
            const newHeight = Math.min(maxHeight, Math.max(minSize, startHeight + (ev.clientY - startY)));
            bubble.style.width = `${newWidth}px`;
            bubble.style.height = `${newHeight}px`;
            if (tailWrap) {
                const currentAngle = parseFloat(tailWrap.getAttribute("data-angle")) || 0;
                updateTailAnchor(bubble, tailWrap, currentAngle);
            }
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // --- Drag to move the whole balloon ---
    bubble.addEventListener("mousedown", (e) => {
        if (bubble.dataset.editing === "true") return;
        if (tailWrap && (e.target === tailWrap || tailWrap.contains(e.target))) return;
        if (e.target === resizeHandle || e.target === deleteBtn) return;
        e.preventDefault();
        const panelRect = panelEl.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeftPct = parseFloat(bubble.style.left) || 0;
        const startTopPct = parseFloat(bubble.style.top) || 0;

        function onMove(ev) {
            const dxPct = ((ev.clientX - startX) / panelRect.width) * 100;
            const dyPct = ((ev.clientY - startY) / panelRect.height) * 100;
            // Clamp based on the balloon's OWN rendered size, not a fixed
            // number — this is what keeps it from ever being dragged far
            // enough that the panel's `overflow: hidden` clips part of it
            // off (which is what was making it look "resized"/reshaped
            // near the edges: it wasn't actually changing size, it was
            // just getting cut off there and displayed in full only
            // toward the center).
            const bubbleWidthPct = (bubble.offsetWidth / panelRect.width) * 100;
            const bubbleHeightPct = (bubble.offsetHeight / panelRect.height) * 100;
            const maxLeft = Math.max(0, 100 - bubbleWidthPct);
            const maxTop = Math.max(0, 100 - bubbleHeightPct);
            const newLeft = Math.min(maxLeft, Math.max(0, startLeftPct + dxPct));
            const newTop = Math.min(maxTop, Math.max(0, startTopPct + dyPct));
            bubble.style.left = `${newLeft}%`;
            bubble.style.top = `${newTop}%`;
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // --- Drag the tail to redirect it toward the speaker: as the angle
    // changes, its attachment point slides around the bubble's own
    // perimeter to match (e.g. pointing right -> anchored on the right
    // edge), instead of staying fixed at the bottom while only rotating. ---
    if (tailWrap) {
        tailWrap.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();

            function onMove(ev) {
                const bubbleRect = bubble.getBoundingClientRect();
                const centerX = bubbleRect.left + bubbleRect.width / 2;
                const centerY = bubbleRect.top + bubbleRect.height / 2;
                const dx = ev.clientX - centerX;
                const dy = ev.clientY - centerY;
                // 0deg = pointing straight down in our base triangle orientation.
                // Base triangle points down (south) at 0deg; CSS rotate()
                // is clockwise-positive, so mapping the mouse offset to an
                // angle needs a negated dx (verified against the rotation
                // matrix: rotating (0,1) clockwise by θ gives (-sinθ, cosθ)).
                const angleDeg = (Math.atan2(-dx, dy) * 180) / Math.PI;
                updateTailAnchor(bubble, tailWrap, angleDeg);
            }
            function onUp() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }
}

function makeBubblesInteractive(panelEl) {
    const bubbles = panelEl.querySelectorAll(".cpg-bubble");
    bubbles.forEach((bubble) => initSingleBubble(panelEl, bubble));
}

// Creates a brand-new balloon (default: speech type, placeholder text)
// and adds it to the given panel, fully interactive right away — used by
// the "+" button in each panel's controls.
function addNewBubbleToPanel(panelEl, type = "speech") {
    const layer = panelEl.querySelector(".cpg-bubbles-layer");
    if (!layer) return;

    const isThought = type === "thought";
    const typeClass = isThought ? "cpg-bubble-thought" : "cpg-bubble-speech";
    const tailHtml = isThought
        ? ""
        : `<div class="cpg-bubble-tail-wrap" style="transform: rotate(0deg);" data-angle="0" title="Drag to point this balloon toward the speaker">
               <div class="cpg-bubble-tail-outline"></div>
               <div class="cpg-bubble-tail-fill"></div>
           </div>`;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<div class="cpg-bubble ${typeClass}" style="left:40%; top:40%;">
        <div class="cpg-bubble-content">New text...</div>
        ${tailHtml}
    </div>`;
    const bubble = wrapper.firstElementChild;
    layer.appendChild(bubble);
    initSingleBubble(panelEl, bubble);

    // Jump straight into edit mode so the person can type the real line right away.
    const content = bubble.querySelector(".cpg-bubble-content");
    if (content) {
        content.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }
}

function fillPanelSuccess(panel, index, imageUrl, panelData, translationInfo) {
    const s = settings();
    panel.className = "cpg-panel";
    const showTranslationBadge = s.translateVisualToEnglish && translationInfo && !translationInfo.applied;
    panel.innerHTML = `
        <img src="${imageUrl}" alt="Panel ${index + 1}" crossorigin="anonymous" />
        <div class="cpg-bubbles-layer">${buildBubblesHtml(panelData.dialogue)}</div>
        ${s.showCaptions ? `<div class="cpg-caption">${escapeHtml(panelData.visual)}</div>` : ""}
        ${showTranslationBadge ? `<span class="cpg-translation-badge" title="Translation skipped: ${escapeHtml(translationInfo.reason)}">⚠️ not translated</span>` : ""}
        <div class="cpg-panel-controls">
            <span class="cpg-panel-number">${index + 1}</span>
            <a class="cpg-download" href="${imageUrl}" download="panel_${index + 1}.png" target="_blank" rel="noopener">⬇</a>
            <span class="cpg-bubble-add" title="Add a new speech balloon">+</span>
        </div>
    `;
    makeBubblesInteractive(panel);
    const addBtn = panel.querySelector(".cpg-bubble-add");
    if (addBtn) {
        addBtn.addEventListener("click", () => addNewBubbleToPanel(panel, "speech"));
    }
}

function fillPanelError(panel, index, errorMessage) {
    panel.className = "cpg-panel cpg-error";
    panel.innerHTML = `
        <div class="cpg-error-text">Panel ${index + 1}: error\n${escapeHtml(errorMessage)}</div>
        <div class="cpg-panel-controls">
            <span class="cpg-panel-number">${index + 1}</span>
        </div>
    `;
}

function attachRetryButton(panelEl, index, panels, results, references, promptInfos, negativePromptOverride) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cpg-retry-btn";
    btn.title = "Regenerate this panel";
    btn.textContent = "🔁";
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        panelEl.className = "cpg-panel cpg-loading";
        panelEl.textContent = `Regenerating panel ${index + 1}...`;
        await generateAndRenderPanel(panelEl, index, panels, results, references, promptInfos, negativePromptOverride);

        // If this is the first panel and it's serving as this conversation's
        // permanent reference anchor, a retry replaces the OLD image on
        // screen with a new one — so the stored reference needs to follow
        // suit, or it would keep pointing at an image that no longer
        // matches what's actually shown.
        const s = settings();
        if (index === 0 && s.useFirstPanelAsReference && results[index] && results[index].url) {
            const chatId = getCurrentChatIdentifier();
            const prepared = await prepareGeneratedImageAsReference(results[index].url, "the regenerated first panel");
            if (prepared) {
                if (!s.firstReferenceByChat) s.firstReferenceByChat = {};
                s.firstReferenceByChat[chatId] = prepared;
                saveSettingsDebounced();
                console.log(`[Comic Panel Generator] First-panel reference for this conversation updated to the regenerated image (chat: "${chatId}").`);
            }
        }
    });
    const controls = panelEl.querySelector(".cpg-panel-controls");
    if (controls) {
        controls.appendChild(btn);
    } else {
        panelEl.appendChild(btn); // fallback, should not normally happen
    }
}

// ------------------------------------------------------------------
// Isolated English translation of just the panel's visual description.
// This is DELIBERATELY separate from the JSON panel-splitting step
// (splitIntoPanels): an earlier attempt to bake a "always answer in
// English" rule directly into that instruction caused the LLM to
// sometimes break the JSON output entirely, producing garbled/wrong
// images. This function instead does a small, standalone text-in/
// text-out translation call on the already-parsed visual description,
// with a safe fallback to the untranslated original if anything fails.
// ------------------------------------------------------------------

async function translateToEnglish(text) {
    if (!text || !text.trim()) return { text, applied: false, reason: "empty input" };
    const context = getContext();
    if (typeof context.generateQuietPrompt !== "function") {
        return { text, applied: false, reason: "generateQuietPrompt not available" };
    }

    try {
        const prompt =
            `Translate the following text to English. Reply with ONLY the translated text, ` +
            `nothing else — no quotes, no explanation, no preamble:\n\n${text}`;
        const raw = await context.generateQuietPrompt(prompt, false, false);
        const translated = (raw || "").trim();
        if (!translated) {
            return { text, applied: false, reason: "LLM returned an empty response" };
        }
        // Sanity check: a faithful translation should be roughly the same
        // length as the original, not several times longer. If the LLM
        // ignored the "only the translated text" instruction and added
        // commentary/explanation, the result can balloon past NanoGPT's
        // prompt length limit (this is what caused the "prompt_too_long"
        // API error). In that case, reject the translation and fall back
        // to the original text instead of risking an oversized prompt.
        if (translated.length > Math.max(300, text.length * 2.5)) {
            return {
                text,
                applied: false,
                reason: `translated response was suspiciously long (${translated.length} vs ${text.length} chars) — rejected`,
            };
        }
        return { text: translated, applied: true, reason: "ok" };
    } catch (err) {
        return { text, applied: false, reason: `LLM call failed: ${err.message || err}` };
    }
}

// NanoGPT rejects prompts longer than 3000 characters ("prompt_too_long").
// We keep a safety margin under that limit, since the exact figure could
// vary by model/route and we'd rather truncate gracefully client-side than
// let the API call fail outright.
const MAX_PROMPT_CHARS = 2800;

// Some models enforce a stricter prompt-length limit than NanoGPT's general
// one (discovered via a real API error: "Qwen Image 3" caps at 800 chars,
// not ~3000). Learned reactively per model from the API's own error message
// the first time it's hit (see the retry logic in generateImage), then
// reused for that model from then on — no need to hardcode a table of
// per-model limits that would inevitably go stale.
const modelPromptCharLimitCache = {};

function truncateForPrompt(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, Math.max(0, maxLen - 1)).trim() + "…";
}

// ------------------------------------------------------------------
// Final prompt construction, handling the NSFW toggle:
// if on, "NSFW" is added to the POSITIVE prompt; if off, it's passed as
// the NEGATIVE prompt (to exclude it) — negative_prompt support is
// however model-specific: NanoGPT documents it as a "model-specific"
// parameter, not guaranteed across all models.
// ------------------------------------------------------------------

function buildFullPrompt(visualDescription) {
    const s = settings();
    const isQwen = isQwenModel(s.model);
    const includeStyle = s.includeClothingStyleText;
    const stylePart = includeStyle ? (isQwen ? `\nStyle: ${s.styleSuffix}` : `, ${s.styleSuffix}`) : "";
    const keyDetails = (s.keyVisualDetails || "").trim();
    const detailsPart = keyDetails ? (isQwen ? `\nKey details: ${keyDetails}` : `, ${keyDetails}`) : "";
    // For Qwen Image, NSFW is now handled natively via the showExplicitContent/
    // enable_safety_checker flags in generateImage() — no need to also stuff
    // "NSFW" into the prompt text for this model. Other models still don't
    // have that dedicated flag, so they keep the old text-based approach.
    const nsfwPart = s.nsfw && !isQwen ? ", NSFW" : "";

    // Reserve room for the style/details/NSFW suffixes, truncate the
    // (usually much longer) visual description first if the whole thing
    // wouldn't fit.
    const reservedLen = stylePart.length + detailsPart.length + nsfwPart.length;
    const budgetForVisual = Math.max(200, MAX_PROMPT_CHARS - reservedLen);

    let visual = visualDescription || "";
    if (visual.length > budgetForVisual) {
        console.warn(`[Comic Panel Generator] ⚠️ Panel prompt too long (${visual.length} chars), truncating to fit NanoGPT's ~3000 character limit.`);
        visual = truncateForPrompt(visual, budgetForVisual);
    }

    let prompt = visual + stylePart + detailsPart + nsfwPart;

    // Final safety net in case something still overflows.
    if (prompt.length > MAX_PROMPT_CHARS) {
        prompt = truncateForPrompt(prompt, MAX_PROMPT_CHARS);
    }

    return prompt;
}

function buildNegativePrompt() {
    const s = settings();
    const parts = [];
    if (s.qualityNegativePrompt && s.qualityNegativePrompt.trim()) {
        parts.push(s.qualityNegativePrompt.trim());
    }
    if (s.comicStyle === "manga") {
        // Some capable models (e.g. Qwen Image 3) can drift toward
        // photorealistic portraits even with a manga-style positive prompt.
        // Explicitly excluding photorealism here reinforces the intended
        // 2D/illustration look.
        parts.push("photorealistic, photograph, photo, realistic skin texture, hyperrealistic, 3D render, real life, DSLR photo");
    }
    if (!s.nsfw) {
        parts.push("NSFW");
    }
    return parts.join(", ");
}

// ------------------------------------------------------------------
// Pre-computes the exact prompt for every panel (translation + style/
// NSFW suffixes applied), WITHOUT generating anything yet. Used to
// populate the "review prompts before generating" screen, so the person
// can read/edit exactly what will be sent before any image is created.
// ------------------------------------------------------------------

async function buildAllPanelPromptInfos(panels) {
    const s = settings();
    const infos = [];

    for (let i = 0; i < panels.length; i++) {
        let visualText = panels[i].visual;
        let translationInfo = null;

        if (s.translateVisualToEnglish) {
            const result = await translateToEnglish(visualText);
            translationInfo = { applied: result.applied, reason: result.reason };
            if (result.applied) {
                console.log(
                    `[Comic Panel Generator] 🌐 Panel ${i + 1} prompt translated:\n  before: ${visualText.slice(0, 100)}\n  after:  ${result.text.slice(0, 100)}`
                );
            } else {
                console.warn(`[Comic Panel Generator] ⚠️ Panel ${i + 1} translation NOT applied — reason: ${result.reason}. Using original text.`);
                notify("warning", `Panel ${i + 1}: translation skipped (${result.reason}) — image prompt stays in the original language.`);
            }
            visualText = result.text;
        }

        infos.push({
            prompt: buildFullPrompt(visualText),
            visualTextUsed: visualText,
            translationInfo,
        });
    }

    return infos;
}

async function generateAndRenderPanel(panelEl, index, panels, results, references, promptInfos, negativePromptOverride) {
    const info = promptInfos[index];
    // Show the ACTUAL text sent to the image API in captions/chat export
    // (translated, if translation is on, and reflecting any manual edit
    // made in the review step), not the original — this is what the
    // person needs to see to verify what really happened.
    // Dialogue stays untouched (original language), since that's for the
    // reader, not the image model.
    const panelDataForDisplay = { ...panels[index], visual: info.visualTextUsed };
    try {
        const url = await generateImage(info.prompt, references, negativePromptOverride);

        fillPanelSuccess(panelEl, index, url, panelDataForDisplay, info.translationInfo);
        results[index] = { url, panelData: panelDataForDisplay };
    } catch (err) {
        console.error(`[Comic Panel Generator] Panel ${index + 1} failed:`, err);
        fillPanelError(panelEl, index, err.message || String(err));
        results[index] = { url: null, panelData: panels[index], error: err.message };
    }
    attachRetryButton(panelEl, index, panels, results, references, promptInfos, negativePromptOverride);
}

// ------------------------------------------------------------------
// Exporting the whole comic page as a single PNG image
// (best-effort: requires the generated images to be canvas-readable;
// if NanoGPT doesn't expose CORS on those URLs, the export fails in a
// controlled way and it's still possible to download panels individually
// with the ⬇ button on each one).
// ------------------------------------------------------------------

let html2canvasLoadingPromise = null;

function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    if (html2canvasLoadingPromise) return html2canvasLoadingPromise;

    html2canvasLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Impossibile caricare html2canvas"));
        document.head.appendChild(script);
    });
    return html2canvasLoadingPromise;
}

async function exportComicAsSingleImage() {
    const pageEl = document.getElementById("cpg_page");
    const statusEl = document.getElementById("cpg_export_status");
    if (!pageEl) return null;

    if (statusEl) statusEl.textContent = "Composing the single comic image...";

    // Rotation ("tilt") + box-shadow together are a known source of color
    // rendering artifacts in html2canvas. We temporarily flatten every
    // panel to 0deg only for the duration of the capture, then restore
    // the original tilt right after, so the live overlay keeps its
    // hand-assembled look but the exported/inserted image doesn't.
    const panels = pageEl.querySelectorAll(".cpg-panel");
    const savedTilts = [];
    panels.forEach((p) => {
        savedTilts.push(p.style.getPropertyValue("--cpg-tilt"));
        p.style.setProperty("--cpg-tilt", "0deg");
    });

    // Hide every editing/UI tool (panel number, retry/download/add buttons,
    // balloon delete "X" and resize handle) for the duration of the
    // capture, so the exported/inserted image contains only the artwork
    // and the speech/thought balloons themselves — none of the on-screen
    // editing chrome. Restored right after, regardless of outcome.
    pageEl.classList.add("cpg-exporting");

    try {
        await loadHtml2Canvas();
        const canvas = await window.html2canvas(pageEl, {
            backgroundColor: "#111111",
            useCORS: true,
            scale: 2,
        });
        const dataUrl = canvas.toDataURL("image/png");
        if (statusEl) statusEl.textContent = "Single image composed successfully.";
        return dataUrl;
    } catch (err) {
        console.warn("[Comic Panel Generator] Single-image export failed (likely CORS limitation):", err);
        if (statusEl) {
            statusEl.textContent =
                `Could not compose a single image (CORS limitation on ${getActiveProviderDisplayName()}'s side). ` +
                "Use the download buttons on individual panels, or insert into chat as separate images.";
        }
        return null;
    } finally {
        panels.forEach((p, i) => p.style.setProperty("--cpg-tilt", savedTilts[i]));
        pageEl.classList.remove("cpg-exporting");
    }
}

// ------------------------------------------------------------------
// Inserting the comic as a chat message (best-effort)
// ------------------------------------------------------------------

async function insertComicIntoChat(panelResults) {
    try {
        const context = getContext();

        const singleImageDataUrl = await exportComicAsSingleImage();

        let mesText;
        if (singleImageDataUrl) {
            mesText = `![comic](${singleImageDataUrl})`;
        } else {
            const s = settings();
            mesText = panelResults
                .filter((p) => p.url)
                .map((p, i) => {
                    const lines = (p.panelData?.dialogue || []).map((d) => `**${d.speaker || "..."}${d.type === "thought" ? " (thought)" : ""}:** ${d.text}`).join("\n");
                    const captionLine = s.showCaptions ? `**Panel ${i + 1}:** ${p.panelData?.visual || ""}\n` : "";
                    return `${captionLine}![panel ${i + 1}](${p.url})${lines ? "\n" + lines : ""}`;
                })
                .join("\n\n");
        }

        const mes = {
            name: "Comic Panel Generator",
            is_user: false,
            is_system: true,
            send_date: Date.now(),
            mes: mesText,
            extra: {},
        };

        context.chat.push(mes);
        if (typeof context.addOneMessage === "function") context.addOneMessage(mes);
        if (typeof context.saveChat === "function") await context.saveChat();
        notify("success", "Comic inserted into chat.");
    } catch (err) {
        console.error("[Comic Panel Generator] Could not insert into chat:", err);
        notify("warning", "Images generated, but insertion into chat failed (see console).");
    }
}

// ------------------------------------------------------------------
// Main flow
// ------------------------------------------------------------------

// Fetches, verifies, and cleanly re-encodes a generated image's URL so it
// can be safely reused as a reference for a later generation — shared by
// both the "last panel" and "first panel of this conversation" reference
// features. Returns null (logging why) if it couldn't be prepared.
async function prepareGeneratedImageAsReference(rawUrl, label) {
    if (!rawUrl) return null;
    if (rawUrl.startsWith("data:")) return rawUrl; // already a verified data URL (e.g. from a custom provider)
    try {
        let verifiedDataUrl = await blobUrlToDataUrl(rawUrl);
        // Re-encode through a canvas to strip any embedded metadata (EXIF,
        // ICC profiles, custom chunks) the generated image might carry —
        // NanoGPT reported a nonsense "image too large" size for this exact
        // kind of reference even though its real, locally-decoded pixel
        // dimensions were entirely normal, consistent with their parser
        // tripping over something other than the actual pixel data.
        try {
            verifiedDataUrl = await reencodeImageCleanly(verifiedDataUrl);
        } catch (reencodeErr) {
            console.warn(`[Comic Panel Generator] Clean re-encode of ${label} failed, using the verified-but-unmodified data URL instead:`, reencodeErr);
        }
        return verifiedDataUrl;
    } catch (err) {
        console.warn(`[Comic Panel Generator] ⚠️ Could not fetch/verify ${label} (${rawUrl}) to reuse as a reference:`, err);
        return null;
    }
}

// Adds an extra reference on top of the current list, respecting the
// model's max-references limit: uses free room if there is any, otherwise
// trades away the lowest-priority existing reference (unless the model
// only supports 1 total, in which case the extra is skipped rather than
// displacing the character/persona reference). Shared logic for both the
// "first panel of this conversation" and "last generated panel" features.
function addExtraReferenceWithTradeoff(currentRefs, maxRefs, extraRef, label, panelIndex) {
    if (!extraRef || maxRefs <= 0) return currentRefs;
    if (currentRefs.length < maxRefs) {
        console.log(`[Comic Panel Generator] Panel ${panelIndex + 1}: adding ${label} as an extra reference (slot ${currentRefs.length + 1}/${maxRefs}).`);
        return currentRefs.concat([extraRef]);
    }
    if (maxRefs > 1) {
        console.log(`[Comic Panel Generator] Panel ${panelIndex + 1}: reference limit (${maxRefs}) already full — trading the lowest-priority reference for ${label}.`);
        return currentRefs.slice(0, maxRefs - 1).concat([extraRef]);
    }
    console.log(`[Comic Panel Generator] Panel ${panelIndex + 1}: model only supports 1 reference — keeping the existing one instead of swapping in ${label}.`);
    return currentRefs;
}

async function onGenerateClick() {
    const s = settings();
    const activeCustomProvider = getActiveCustomProvider(s);

    if (!activeCustomProvider && !s.apiKey) {
        notify("error", "Please enter your NanoGPT API Key first.");
        return;
    }
    if (activeCustomProvider && !activeCustomProvider.noAuth && !activeCustomProvider.apiKey) {
        notify("error", `Please enter an API key for "${activeCustomProvider.name}", or mark it as "no authentication needed".`);
        return;
    }

    const sourceText = getSourceText();
    if (!sourceText) {
        notify("error", "No source text found (empty chat or empty custom text field).");
        return;
    }

    const numPanels = s.numPanels;
    setStatus("Generating panel descriptions...");
    notify("info", "Generating the comic, this might take a few seconds...");

    let panels;
    try {
        panels = await splitIntoPanels(sourceText, numPanels);
    } catch (err) {
        console.error(err);
        notify("error", "Error while splitting the scene into panels.");
        setStatus("Error while splitting the scene.");
        return;
    }

    setStatus("Fetching reference images (character avatars / custom)...");
    const { baseReferences, maxRefs } = await buildBaseReferencesForGeneration(s.model);

    if (baseReferences.length > 0) {
        setStatus(`✅ Using ${baseReferences.length} reference image(s) to keep characters consistent.`);
        notify("info", `Using ${baseReferences.length} reference image(s) (see Console for details).`);
    } else if (s.useCharacterAvatars) {
        setStatus("⚠️ No reference image found/used (see Console for why).");
        notify("warning", "No character avatar found as a reference: check the Console (F12).");
    }

    setStatus("Preparing panel prompts...");
    let promptInfos = await buildAllPanelPromptInfos(panels);
    let negativePromptToUse = buildNegativePrompt();

    if (s.reviewPromptsBeforeGenerating) {
        const review = await openPromptReviewOverlay(panels, promptInfos, negativePromptToUse);
        if (!review.confirmed) {
            setStatus("Cancelled.");
            notify("info", `Comic generation cancelled — nothing was sent to ${getActiveProviderDisplayName()}.`);
            return;
        }
        promptInfos = review.promptInfos;
        negativePromptToUse = review.negativePrompt;
    }

    const grid = openOverlay(panels.length, s.comicStyle);
    const results = [];
    let lastGeneratedForReference = null;

    // "First panel of this conversation" reference: loaded once at the
    // start (persisted per-chat, so it survives across separate "Generate
    // comic" runs, not just within this one), used as an extra consistency
    // anchor on top of — never instead of — the character/persona
    // reference images. This deliberately does NOT replace those: if the
    // scene moves to a very different setting later, the character/persona
    // avatars stay just as relevant regardless, while this first-panel
    // anchor is purely additive.
    const chatId = s.useFirstPanelAsReference ? getCurrentChatIdentifier() : null;
    let firstPanelReference = s.useFirstPanelAsReference ? (s.firstReferenceByChat?.[chatId] || null) : null;
    if (firstPanelReference) {
        console.log(`[Comic Panel Generator] Using this conversation's stored first-panel reference (chat: "${chatId}").`);
    }

    for (let i = 0; i < panels.length; i++) {
        const panelEl = addLoadingPanel(grid, i);
        results.push(null); // placeholder, filled inside generateAndRenderPanel

        let referencesForPanel = baseReferences;
        if (s.useFirstPanelAsReference && firstPanelReference && maxRefs > 0) {
            referencesForPanel = addExtraReferenceWithTradeoff(referencesForPanel, maxRefs, firstPanelReference, "this conversation's first-panel reference", i);
        }
        if (s.useLastPanelAsReference && lastGeneratedForReference && maxRefs > 0) {
            referencesForPanel = addExtraReferenceWithTradeoff(referencesForPanel, maxRefs, lastGeneratedForReference, "the previous panel's image", i);
        }

        await generateAndRenderPanel(panelEl, i, panels, results, referencesForPanel, promptInfos, negativePromptToUse);
        setStatus(`Panel ${i + 1}/${panels.length} completed.`);

        if (results[i] && results[i].url) {
            // Store THIS panel as the conversation's first-panel reference,
            // but only if we don't already have one for this chat — it's
            // meant to stay stable as a long-term anchor, not get replaced
            // by every new generation.
            if (s.useFirstPanelAsReference && !firstPanelReference) {
                const prepared = await prepareGeneratedImageAsReference(results[i].url, `panel ${i + 1}`);
                if (prepared) {
                    firstPanelReference = prepared;
                    if (!s.firstReferenceByChat) s.firstReferenceByChat = {};
                    s.firstReferenceByChat[chatId] = prepared;
                    saveSettingsDebounced();
                    console.log(`[Comic Panel Generator] Stored this panel as the permanent first-panel reference for this conversation (chat: "${chatId}").`);
                }
            }

            if (s.useLastPanelAsReference) {
                lastGeneratedForReference = await prepareGeneratedImageAsReference(results[i].url, `panel ${i + 1}`);
            }
        }
    }

    setStatus("Comic completed.");
    notify("success", "Comic generated!");

    const refSummary = document.getElementById("cpg_ref_summary");
    if (refSummary) {
        const allRefs = [...baseReferences];
        if (s.useFirstPanelAsReference && firstPanelReference && !allRefs.includes(firstPanelReference)) {
            allRefs.push(firstPanelReference);
        }
        if (allRefs.length > 0) {
            refSummary.innerHTML = allRefs
                .map((url, i) => `<img src="${url}" class="cpg-ref-summary-thumb" title="Reference image ${i + 1} used for this comic" alt="Reference ${i + 1}" />`)
                .join("");
        }
    }

    const insertBtn = document.getElementById("cpg_insert_now_btn");
    if (insertBtn) {
        insertBtn.disabled = false;
        insertBtn.title = "";
        insertBtn.addEventListener("click", async () => {
            insertBtn.disabled = true;
            insertBtn.textContent = "📩 Inserting...";
            await insertComicIntoChat(results);
            const overlay = document.getElementById("cpg_overlay");
            if (overlay) overlay.remove();
        });
    }

    const exportBtn = document.getElementById("cpg_export_btn");
    if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.title = "";
        exportBtn.addEventListener("click", async () => {
            const dataUrl = await exportComicAsSingleImage();
            if (!dataUrl) return;
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = "comic.png";
            a.click();
        });
    }

    if (s.insertIntoChat) {
        await insertComicIntoChat(results);
    }
}

async function onTestClick() {
    const s = settings();
    const activeCustomProvider = getActiveCustomProvider(s);

    if (!activeCustomProvider && !s.apiKey) {
        notify("error", "Please enter your NanoGPT API Key first.");
        return;
    }
    if (activeCustomProvider && !activeCustomProvider.noAuth && !activeCustomProvider.apiKey) {
        notify("error", `Please enter an API key for "${activeCustomProvider.name}", or mark it as "no authentication needed".`);
        return;
    }

    setStatus("Testing...");
    try {
        const url = await generateImage("a small red circle on white background, minimal test image", []);
        setStatus("Test succeeded! Image generated correctly.");
        notify("success", `Connection to ${activeCustomProvider ? activeCustomProvider.name : "NanoGPT"} OK.`);
        console.log("[Comic Panel Generator] Test image URL:", url);
    } catch (err) {
        setStatus("Test failed: " + (err.message || err));
        notify("error", "Test failed, check API Key / model / console.");
        console.error(err);
    }
}

// ------------------------------------------------------------------
// Extension bootstrap
// ------------------------------------------------------------------

jQuery(async () => {
    loadSettings();

    const container = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
    if (!container) {
        console.error("[Comic Panel Generator] Extension settings container not found.");
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildSettingsHtml();
    container.appendChild(wrapper.firstElementChild);

    bindSettingsEvents();
    injectWandMenuButton();

    const s = settings();
    if (s.model) {
        applyGenerationParamsForModelUI(s.model); // async, fire-and-forget: fills Steps/CFG for the saved model
    }

    console.log("[Comic Panel Generator] Extension loaded.");
});
