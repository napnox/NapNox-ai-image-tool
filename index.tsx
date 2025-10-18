/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type, Modality } from "@google/genai";

// =================================================================================
// --- API KEY CONFIGURATION ---
// The application is now configured with the API key you provided.
// =================================================================================
const API_KEY = "AIzaSyAdYhYqZc4F3kBHF8sPgb-DU3ZipWSiYJY";


// --- DOM ELEMENT REFERENCES ---
const form = document.getElementById('prompt-form') as HTMLFormElement;
const imageUpload = document.getElementById('image-upload') as HTMLInputElement;
const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
const uploadPlaceholder = document.getElementById('upload-placeholder');
const imagePreviewWrapper = document.querySelector('.image-preview-wrapper');
const removeImageBtn = document.getElementById('remove-image-btn') as HTMLButtonElement;
const imageUploadLabel = document.getElementById('image-upload-label') as HTMLLabelElement;
const userPromptLabel = document.getElementById('user-prompt-label') as HTMLLabelElement;
const userPromptTextarea = document.getElementById('user-prompt') as HTMLTextAreaElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const loader = document.getElementById('loader');
const loaderTip = document.getElementById('loader-tip') as HTMLParagraphElement;
const resultsPanel = document.getElementById('results-panel') as HTMLElement;
const resultsGrid = document.getElementById('results-grid');
const resultsPlaceholder = document.getElementById('results-placeholder');
const fullscreenModal = document.getElementById('fullscreen-modal');
const fullscreenImage = document.getElementById('fullscreen-image') as HTMLImageElement;
const closeModalBtn = document.getElementById('close-modal-btn') as HTMLButtonElement;
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement;


// --- GEMINI API SETUP ---
let ai: GoogleGenAI | null = null;
try {
  ai = new GoogleGenAI({ apiKey: API_KEY });
} catch (error) {
    console.error("AI Initialization Error:", error);
    alert("Could not initialize the AI client. The embedded API key might be invalid or restricted. Please check the console for details.");
    generateBtn.disabled = true;
    generateBtn.textContent = "Configuration Error";
}


// --- APPLICATION STATE & CONSTANTS ---
const state = {
  uploadedImage: {
    base64: null as string | null,
    mimeType: null as string | null,
  },
  isLoading: false,
};

const creativeTips = [
    "Tip: Combining unexpected concepts can lead to surprising results!",
    "Did you know? 'Golden hour' lighting creates a warm, soft glow.",
    "Pro-tip: Use 'cinematic' in your prompt for a movie-like feel.",
    "Try using negative prompts to specify what you *don't* want in the image.",
    "The more specific your prompt, the closer the AI can get to your vision.",
    "Experiment with different art styles like 'watercolor' or '3D render'.",
    "AI is great at details. Try asking for specific textures or materials.",
    "Thinking of a mood... 'serene', 'chaotic', 'nostalgic'?",
];
let tipInterval: number | null = null;


// --- HELPER FUNCTIONS ---

/**
 * Gets the current value from the segmented control.
 */
function getGenerationSource(): 'hybrid' | 'prompt' | 'image' {
    const checkedRadio = form.querySelector('input[name="generation-source"]:checked') as HTMLInputElement;
    return checkedRadio.value as 'hybrid' | 'prompt' | 'image';
}

/**
 * Attaches all the necessary event listeners for the application.
 */
function attachEventListeners() {
    // Trigger file input when the preview area is clicked
    imagePreviewWrapper?.addEventListener('click', () => imageUpload.click());

    // Handle image selection
    imageUpload.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            try {
                const { base64, mimeType } = await fileToBase64(file);
                state.uploadedImage.base64 = base64;
                state.uploadedImage.mimeType = mimeType;
                imagePreview.src = `data:${mimeType};base64,${base64}`;
                imagePreview.classList.remove('hidden');
                uploadPlaceholder?.classList.add('hidden');
                removeImageBtn.classList.remove('hidden');
            } catch (error) {
                console.error("Error reading file:", error);
                alert("Could not read the selected file. Please try another image.");
            }
        }
    });

    // Handle image removal
    removeImageBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent the wrapper's click event from firing
        state.uploadedImage.base64 = null;
        state.uploadedImage.mimeType = null;
        imagePreview.src = '#';
        imagePreview.classList.add('hidden');
        uploadPlaceholder?.classList.remove('hidden');
        removeImageBtn.classList.add('hidden');
        imageUpload.value = ''; // Reset file input
    });

    // Handle form submission to generate images
    form.addEventListener('submit', handleFormSubmit);

    // Update UI based on generation source
    form.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement;
        if (target.name === 'generation-source') {
            updateFormUI();
        }
    });

    // Modal listeners
    if (fullscreenModal && fullscreenImage && closeModalBtn && zoomInBtn && zoomOutBtn) {
        closeModalBtn.addEventListener('click', closeModal);
        fullscreenModal.addEventListener('click', (e) => {
            if (e.target === fullscreenModal) {
                closeModal();
            }
        });
        zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modalState.zoom += 0.2;
            fullscreenImage.classList.add('is-zoomed');
            updateImageTransform();
        });
        zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modalState.zoom = Math.max(1, modalState.zoom - 0.2);
            if (modalState.zoom === 1) {
                fullscreenImage.classList.remove('is-zoomed');
                modalState.pan.x = 0;
                modalState.pan.y = 0;
            }
            updateImageTransform();
        });
        fullscreenImage.addEventListener('mousedown', (e) => {
            if (modalState.zoom <= 1) return;
            e.preventDefault();
            modalState.isDragging = true;
            modalState.start.x = e.clientX - modalState.pan.x;
            modalState.start.y = e.clientY - modalState.pan.y;
            fullscreenImage.classList.add('is-grabbing');
        });
        fullscreenImage.addEventListener('mousemove', (e) => {
            if (!modalState.isDragging) return;
            e.preventDefault();
            modalState.pan.x = e.clientX - modalState.start.x;
            modalState.pan.y = e.clientY - modalState.start.y;
            updateImageTransform();
        });
        const stopDragging = () => {
            if (modalState.isDragging) {
                modalState.isDragging = false;
                fullscreenImage.classList.remove('is-grabbing');
            }
        };
        window.addEventListener('mouseup', stopDragging);
        fullscreenImage.addEventListener('mouseleave', stopDragging);
    }
}

// --- CORE LOGIC ---

/**
 * The main submit handler for the form.
 */
async function handleFormSubmit(event: Event) {
    event.preventDefault();
    
    if (!ai || generateBtn.disabled) {
        alert("Application is not ready. The API key might be invalid.");
        return;
    }

    // Form validation
    const source = getGenerationSource();
    if ((source === 'hybrid' || source === 'image') && !state.uploadedImage.base64) {
        alert("Please upload an image for this generation source.");
        return;
    }
    if ((source === 'hybrid' || source === 'prompt') && !userPromptTextarea.value.trim()) {
        alert("Please describe your vision in the prompt field.");
        return;
    }
    await handleGeneration();
}

/**
 * Main function to handle the AI generation process.
 */
async function handleGeneration() {
  if (!ai) return; 
  setLoading(true);

  try {
    const creativePrompts = await generateCreativePrompts();
    const imageGenerationPromises = creativePrompts.map(prompt =>
      generateImage(prompt)
    );
    const generatedImages = await Promise.all(imageGenerationPromises);
    displayResults(generatedImages);

  } catch (error) {
    console.error("An error occurred during generation:", error);
    alert("An error occurred. Your API key might be invalid or there could be a network issue. Please check the console for details.");
    resultsPlaceholder?.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
}

/**
 * Generates a list of creative prompts based on user input.
 */
async function generateCreativePrompts(): Promise<string[]> {
  if (!ai) throw new Error("AI client not initialized.");

  const numVariations = document.getElementById('num-variations') as HTMLSelectElement;
  const generationSource = getGenerationSource();
  const aspectRatio = (document.getElementById('aspect-ratio') as HTMLSelectElement).value;

  let systemInstruction = '';

  if (generationSource === 'prompt') {
    systemInstruction = `You are a creative AI image prompt builder. Your job is to create refined, detailed, and imaginative prompts for a new image from scratch. Use the user's text and filter selections to produce well-structured prompt descriptions. Each prompt must be 1-2 sentences. The most critical instruction is that the final image MUST strictly match the aspect ratio of ${aspectRatio}. Explicitly mention this aspect ratio in every prompt you generate.`;
  } else { // For 'hybrid' and 'image'
    systemInstruction = `You are an expert AI photo editor. Your job is to create prompts that act as editing instructions for a user's uploaded image. The prompts must describe how to modify or transform the uploaded photo based on the provided filters and user text. Start prompts with phrases like "Modify the uploaded image..." or "Transform the person in the photo to...". Do NOT describe a new scene or person from scratch. The output must be an editing instruction. The most critical instruction is to ensure the final edited image respects the requested aspect ratio of ${aspectRatio}, for example by cropping, extending the background, or reframing the scene.`;
  }
  
  const promptDetails = Array.from(form.querySelectorAll('select, textarea'))
    .map(el => {
        const input = el as HTMLSelectElement | HTMLTextAreaElement;
        const label = form.querySelector(`label[for="${input.id}"]`)?.textContent || input.id;
        // Exclude the user prompt textarea if the mode is 'image' or if it's empty and not required
        if (input.id === 'user-prompt' && (generationSource === 'image' || !input.value.trim())) {
             return null;
        }
        // Exclude generation source from the prompt details sent to the AI
        if (input.name === 'generation-source') {
            return null;
        }
        // Emphasize aspect ratio in the prompt details as well
        if (input.id === 'aspect-ratio') {
            return `${label}: "${input.value}" (This is a strict requirement).`;
        }
        return `${label}: "${input.value}"`;
    }).filter(Boolean).join('\n');
    
  const finalPrompt = `Generate ${numVariations.value} distinct and creative prompt variations based on the following details. PRIORITY #1: Each generated prompt MUST strictly adhere to and explicitly mention the requested aspect ratio of ${aspectRatio}. This is not optional.\n\n${promptDetails}`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: finalPrompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      }
    }
  });

  const jsonResponse = JSON.parse(response.text);
  if (!jsonResponse.prompts || jsonResponse.prompts.length === 0) {
      throw new Error("AI did not return any prompts.");
  }
  return jsonResponse.prompts;
}

/**
 * Generates a single image based on a prompt and optionally the uploaded image.
 */
async function generateImage(prompt: string): Promise<{ prompt: string; imageBase64: string }> {
  if (!ai) throw new Error("AI client not initialized.");

  const textPart = { text: prompt };
  const parts: ( {text: string} | {inlineData: {data: string, mimeType: string}} )[] = [textPart];
  
  const generationSource = getGenerationSource();
  if ((generationSource === 'hybrid' || generationSource === 'image') && state.uploadedImage.base64 && state.uploadedImage.mimeType) {
    const imagePart = {
      inlineData: {
        data: state.uploadedImage.base64,
        mimeType: state.uploadedImage.mimeType,
      },
    };
    parts.unshift(imagePart);
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts },
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });
  
  const firstPart = response.candidates?.[0]?.content?.parts?.[0];
  if (firstPart && 'inlineData' in firstPart && firstPart.inlineData) {
    return {
      prompt,
      imageBase64: firstPart.inlineData.data,
    };
  } else {
    throw new Error("Could not extract image from Gemini response.");
  }
}

/**
 * Handles regenerating a single image for a specific card.
 */
async function handleRegenerate(card: HTMLElement, prompt: string) {
    const loader = card.querySelector('.card-loader') as HTMLElement;
    const img = card.querySelector('img');
    if (!loader || !img) return;

    loader.classList.remove('hidden');
    try {
        const { imageBase64 } = await generateImage(prompt);
        const newImageUrl = `data:image/png;base64,${imageBase64}`;
        img.src = newImageUrl;
        
        // Update download, view, and share buttons to use the new image
        const downloadBtn = card.querySelector('.download-btn') as HTMLButtonElement;
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.href = newImageUrl;
            link.download = `napnox-ai-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        const viewBtn = card.querySelector('.view-btn') as HTMLButtonElement;
        viewBtn.onclick = () => openModal(newImageUrl);

        const shareBtn = card.querySelector('.share-btn') as HTMLButtonElement;
        if (shareBtn && navigator.share) {
            shareBtn.onclick = () => shareImage(newImageUrl, prompt);
        }

    } catch (error) {
        console.error("Regeneration failed:", error);
        alert("Failed to regenerate the image. Please try again.");
    } finally {
        loader.classList.add('hidden');
    }
}

/**
 * Handles sharing an image using the Web Share API.
 */
async function shareImage(url: string, text: string) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], `napnox-ai-image-${Date.now()}.png`, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: 'AI Image from NapNox Studio',
                text: `Check out this image I created! Prompt: ${text}`,
                files: [file],
            });
        } else {
            alert('Your browser does not support sharing this file.');
        }
    } catch (error) {
        console.error('Error sharing:', error);
        // Do not show an alert if the user cancels the share dialog.
        if ((error as Error).name !== 'AbortError') {
            alert('An error occurred while trying to share.');
        }
    }
}


// --- UI & HELPER FUNCTIONS ---

/**
 * Updates form labels and required fields based on the selected generation source.
 */
function updateFormUI() {
    const source = getGenerationSource();
    if (source === 'prompt') {
        imageUploadLabel.textContent = '1. Upload Your Photo (Optional)';
        userPromptLabel.textContent = '2. Describe Your Vision (Required)';
    } else if (source === 'image') {
        imageUploadLabel.textContent = '1. Upload Your Photo (Required)';
        userPromptLabel.textContent = '2. Describe Your Vision (Optional)';
    } else { // Hybrid
        imageUploadLabel.textContent = '1. Upload Your Photo (Required)';
        userPromptLabel.textContent = '2. Describe Your Vision (Required)';
    }
}

/**
 * Updates the UI to show/hide the loading state.
 */
function setLoading(isLoading: boolean) {
  state.isLoading = isLoading;
  generateBtn.disabled = isLoading;
  loader?.classList.toggle('hidden', !isLoading);
  
  if (isLoading) {
    resultsPanel.classList.remove('has-results');
    resultsPlaceholder?.classList.add('hidden');
    resultsGrid.innerHTML = '';
    
    // Start tip cycling
    const showRandomTip = () => {
        const randomIndex = Math.floor(Math.random() * creativeTips.length);
        loaderTip.textContent = creativeTips[randomIndex];
    };
    showRandomTip(); // Show one immediately
    tipInterval = window.setInterval(showRandomTip, 3500);

  } else {
      // Stop tip cycling
      if (tipInterval) {
          clearInterval(tipInterval);
          tipInterval = null;
      }
      loaderTip.textContent = '';
  }
}

/**
 * Renders the generated image results in the grid.
 */
function displayResults(results: { prompt: string; imageBase64: string }[]) {
  resultsGrid.innerHTML = '';
  if (results.length === 0) {
      resultsPlaceholder.classList.remove('hidden');
      resultsPanel.classList.remove('has-results');
      return;
  }
  resultsPlaceholder.classList.add('hidden');
  results.forEach(result => {
    const card = createResultCard(result.prompt, result.imageBase64);
    resultsGrid.appendChild(card);
  });
  resultsPanel.classList.add('has-results');
}

/**
 * Creates a DOM element for a single result card.
 */
function createResultCard(prompt: string, imageBase64: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'result-card';
  const imageUrl = `data:image/png;base64,${imageBase64}`;

  card.innerHTML = `
    <div class="card-loader hidden"><div class="spinner"></div></div>
    <img src="${imageUrl}" alt="${prompt.substring(0, 50)}...">
    <div class="prompt-info">
      <p class="prompt-text">${prompt}</p>
      <div class="card-actions">
        <button class="copy-btn">Copy Prompt</button>
        <button class="regenerate-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Regen
        </button>
        <button class="share-btn icon-btn" title="Share Image">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
        </button>
        <button class="download-btn icon-btn" title="Download Image">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="view-btn icon-btn" title="View fullscreen">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    </div>
  `;

  const copyBtn = card.querySelector('.copy-btn') as HTMLButtonElement;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(prompt).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy Prompt';
        copyBtn.classList.remove('copied');
      }, 2000);
    });
  });

  const downloadBtn = card.querySelector('.download-btn') as HTMLButtonElement;
  downloadBtn.onclick = () => {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `napnox-ai-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const viewBtn = card.querySelector('.view-btn') as HTMLButtonElement;
  viewBtn.onclick = () => openModal(imageUrl);

  const shareBtn = card.querySelector('.share-btn') as HTMLButtonElement;
  if (navigator.share) {
    shareBtn.onclick = () => shareImage(imageUrl, prompt);
  } else {
    shareBtn.style.display = 'none';
  }

  const regenerateBtn = card.querySelector('.regenerate-btn') as HTMLButtonElement;
  regenerateBtn.addEventListener('click', () => {
      handleRegenerate(card, prompt);
  });

  return card;
}


/**
 * Converts an image file to a base64 string.
 */
function fileToBase64(file: File): Promise<{ base64: string, mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// --- MODAL LOGIC & CONTROLS ---

const modalState = {
    zoom: 1,
    isDragging: false,
    pan: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
};

function updateImageTransform() {
    if (!fullscreenImage) return;
    fullscreenImage.style.transform = `translate(${modalState.pan.x}px, ${modalState.pan.y}px) scale(${modalState.zoom})`;
}

function resetModalState() {
    modalState.zoom = 1;
    modalState.pan.x = 0;
    modalState.pan.y = 0;
    modalState.isDragging = false;
    updateImageTransform();
    fullscreenImage.classList.remove('is-zoomed', 'is-grabbing');
}

function closeModal() {
    if (!fullscreenModal) return;
    fullscreenModal.classList.add('hidden');
    resetModalState();
}

function openModal(imageUrl: string) {
    if (!fullscreenImage || !fullscreenModal) return;
    resetModalState();
    fullscreenImage.src = imageUrl;
    fullscreenModal.classList.remove('hidden');
}

/**
 * Main application entry point.
 * Sets up the UI and attaches event listeners.
 */
function initializeApp() {
    updateFormUI();
    attachEventListeners();
}


// --- INITIAL APP STARTUP ---
initializeApp();