import { describeWebGPUSupport } from './grass-webgpu/capability.js';

window.__ready = false;

function showFailure(title, message, error) {
  const loading = document.getElementById('loading-screen');
  const heading = document.getElementById('loading-heading');
  const text = document.getElementById('loading-text');
  loading?.classList.add('bed-loading-error');
  if (heading) heading.textContent = title;
  if (text) text.textContent = message;
  if (error) console.error(error);
}

document.addEventListener('DOMContentLoaded', async () => {
  const support = describeWebGPUSupport({
    secureContext: window.isSecureContext,
    gpu: navigator.gpu,
  });
  if (!support.supported) {
    showFailure('WebGPU niedostępne', support.message);
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      showFailure(
        'Brak adaptera WebGPU',
        'Przeglądarka udostępnia WebGPU, ale nie otworzyła tej karty graficznej.',
      );
      return;
    }

    // Same shape as the field's entry: the capability gate is this module's
    // only static dependency, so an unsupported browser never downloads the
    // runtime bundle.
    const { startBed } = await import('./bed-runtime.js');
    await startBed({ adapter });
  } catch (error) {
    showFailure(
      'Grządka się nie uruchomiła',
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
});
