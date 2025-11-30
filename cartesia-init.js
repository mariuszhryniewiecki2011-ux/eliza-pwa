(function () {
  /**
   * Minimal Cartesia init wrapper.
   * - containerId: id of the DOM element to mount into
   * - apiKey: optional API key string (pass null to initialize without)
   *
   * Returns a Promise that resolves to the Cartesia instance (whatever the SDK returns).
   * If the SDK global name differs, adjust accordingly.
   */
  function initCartesia(containerId, apiKey) {
    return new Promise((resolve, reject) => {
      try {
        if (!window.Cartesia) {
          return reject(new Error('Cartesia SDK not found. Make sure the CDN script loaded.'));
        }
        var container = document.getElementById(containerId);
        if (!container) {
          return reject(new Error('Cartesia container element not found: #' + containerId));
        }

        // Basic options — adjust per Cartesia docs if needed
        var options = {
          container: container,
        };
        if (apiKey) options.apiKey = apiKey;

        // Try to init — adapt if SDK uses different init method
        var instance = window.Cartesia && window.Cartesia.init ? window.Cartesia.init(options) : null;

        if (!instance) {
          // If SDK exposes a constructor or other API, adapt here.
          return reject(new Error('Could not create Cartesia instance. Check SDK API.'));
        }

        // expose a convenience method
        instance.show = instance.show || function () {
          // many SDKs will manage rendering automatically; provide a noop
          return Promise.resolve();
        };
        instance.resize = instance.resize || function () { /* noop */ };

        resolve(instance);
      } catch (err) {
        reject(err);
      }
    });
  }

  window.initCartesia = initCartesia;
})();
