(function () {
  // Improved fetch with timeout
  async function fetchJson(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      var res = await fetch(url, { 
        credentials: 'same-origin',
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (!res.ok) {
        throw new Error('Network error: ' + res.status + ' ' + res.statusText);
      }
      return res.json();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after ' + timeoutMs + 'ms');
      }
      throw error;
    }
  }

  function initCartesia(containerId, apiKey) {
    return new Promise((resolve, reject) => {
      try {
        if (!window.Cartesia) {
          // If there's no in-browser SDK, we still resolve an adapter that proxies to backend.
          var adapter = {
            show: function () { return Promise.resolve(); },
            resize: function () {},
            
            // async functions:
            listLanguages: async function () {
              try {
                return await fetchJson('/api/languages');
              } catch (e) {
                console.error('Failed to fetch languages:', e);
                return [];
              }
            },
            
            listVoices: async function (languageId) {
              try {
                var url = '/api/voices' + (languageId ? '?language=' + encodeURIComponent(languageId) : '');
                return await fetchJson(url);
              } catch (e) {
                console.error('Failed to fetch voices:', e);
                return [];
              }
            },
            
            synthesize: async function (opts) {
              // opts: { text, language, voice, model_id, output_format }
              if (!opts.text) {
                throw new Error('Text is required for synthesis');
              }
              
              var body = {
                text: opts.text,
                language: opts.language,
                voice_id: opts.voice,
                model_id: opts.model_id || 'sonic-2',
                output_format: opts.output_format || {
                  container: 'wav',
                  sample_rate: 44100,
                  encoding: 'pcm_f32le'
                },
              };
              
              var res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              
              if (!res.ok) {
                var errorText = await res.text();
                throw new Error('TTS request failed: ' + res.status + ' - ' + errorText);
              }
              
              return res.arrayBuffer(); // caller can convert to blob
            }
          };
          return resolve(adapter);
        }

        var container = document.getElementById(containerId);
        if (!container) {
          return reject(new Error('Cartesia container element not found: #' + containerId));
        }

        var options = { container: container };
        if (apiKey) options.apiKey = apiKey;

        var instance = window.Cartesia && window.Cartesia.init ? window.Cartesia.init(options) : null;
        if (!instance) {
          try {
            instance = new window.Cartesia(options);
          } catch (e) {
            return reject(new Error('Could not create Cartesia instance: ' + (e.message || e)));
          }
        }
        
        if (!instance) {
          return reject(new Error('Could not create Cartesia instance. Check SDK API.'));
        }

        instance.show = instance.show || function () { return Promise.resolve(); };
        instance.resize = instance.resize || function () {};

        // normalize helper
        function normalizeEntries(arr, idKeys, nameKeys) {
          if (!Array.isArray(arr)) return [];
          return arr.map(function (it) {
            if (!it) return null;
            if (typeof it === 'string') return { id: it, name: it };
            
            var id = null, name = null;
            for (var i = 0; i < idKeys.length; i++) {
              if (it[idKeys[i]] !== undefined) {
                id = it[idKeys[i]];
                break;
              }
            }
            for (var j = 0; j < nameKeys.length; j++) {
              if (it[nameKeys[j]] !== undefined) {
                name = it[nameKeys[j]];
                break;
              }
            }
            
            // Better fallback for ID
            if (!id) {
              id = it.value || it.code || 'unknown';
            }
            name = name || id;
            
            return { id: String(id), name: String(name) };
          }).filter(Boolean);
        }

        // prefer SDK methods if available, otherwise fallback to backend
        instance.listLanguages = async function () {
          try {
            if (typeof instance.getLanguages === 'function') {
              var out = instance.getLanguages();
              var arr = (out && typeof out.then === 'function') ? await out : out;
              return normalizeEntries(arr, ['id', 'code', 'lang'], ['name', 'label', 'title']);
            }
            if (window.Cartesia && typeof window.Cartesia.getLanguages === 'function') {
              var out2 = window.Cartesia.getLanguages();
              var arr2 = (out2 && typeof out2.then === 'function') ? await out2 : out2;
              return normalizeEntries(arr2, ['id', 'code', 'lang'], ['name', 'label', 'title']);
            }
            if (Array.isArray(instance.languages)) {
              return normalizeEntries(instance.languages, ['id', 'code', 'lang'], ['name', 'label', 'title']);
            }
          } catch (e) {
            console.warn('SDK language fetch failed, falling back to API:', e);
          }
          
          // final fallback: backend
          try {
            return await fetchJson('/api/languages');
          } catch (e) {
            console.error('Backend language fetch failed:', e);
            return [];
          }
        };

        instance.listVoices = async function (languageId) {
          try {
            if (typeof instance.getVoices === 'function') {
              var out = instance.getVoices(languageId);
              var arr = (out && typeof out.then === 'function') ? await out : out;
              return normalizeEntries(arr, ['id', 'voice', 'value'], ['name', 'label', 'title']);
            }
            if (window.Cartesia && typeof window.Cartesia.getVoices === 'function') {
              var out2 = window.Cartesia.getVoices(languageId);
              var arr2 = (out2 && typeof out2.then === 'function') ? await out2 : out2;
              return normalizeEntries(arr2, ['id', 'voice', 'value'], ['name', 'label', 'title']);
            }
            if (instance.voices && typeof instance.voices === 'object') {
              var maybe = instance.voices[languageId] || instance.voices;
              if (Array.isArray(maybe)) {
                return normalizeEntries(maybe, ['id', 'voice', 'value'], ['name', 'label', 'title']);
              }
            }
          } catch (e) {
            console.warn('SDK voice fetch failed, falling back to API:', e);
          }
          
          // fallback to backend
          try {
            var url = '/api/voices' + (languageId ? '?language=' + encodeURIComponent(languageId) : '');
            return await fetchJson(url);
          } catch (e) {
            console.error('Backend voice fetch failed:', e);
            return [];
          }
        };

        // add a synthesize helper that uses SDK when available else backend
        instance.synthesize = async function (opts) {
          if (!opts || !opts.text) {
            throw new Error('Text is required for synthesis');
          }
          
          // try SDK first
          try {
            if (instance.tts && typeof instance.tts.bytes === 'function') {
              var sdkResult = instance.tts.bytes({
                model_id: opts.model_id || 'sonic-2',
                transcript: opts.text,
                voice: opts.voice ? { mode: 'id', id: opts.voice } : undefined,
                language: opts.language,
                output_format: opts.output_format || {
                  container: 'wav',
                  sample_rate: 44100,
                  encoding: 'pcm_f32le'
                },
              });
              
              // if promise
              if (sdkResult && typeof sdkResult.then === 'function') {
                sdkResult = await sdkResult;
              }
              
              if (sdkResult instanceof ArrayBuffer || sdkResult instanceof Uint8Array || typeof sdkResult === 'string') {
                return sdkResult;
              }
              
              // fallback if object contains 'audio'
              if (sdkResult && sdkResult.audio) {
                return sdkResult.audio;
              }
            }
          } catch (e) {
            console.warn('SDK synthesis failed, falling back to API:', e);
          }
          
          // backend fallback
          var body = {
            text: opts.text,
            language: opts.language,
            voice_id: opts.voice,
            model_id: opts.model_id || 'sonic-2',
            output_format: opts.output_format || {
              container: 'wav',
              sample_rate: 44100,
              encoding: 'pcm_f32le'
            },
          };
          
          var res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          
          if (!res.ok) {
            var errorText = await res.text();
            throw new Error('TTS request failed: ' + res.status + ' - ' + errorText);
          }
          
          return await res.arrayBuffer();
        };

        resolve(instance);
      } catch (err) {
        reject(err);
      }
    });
  }

  window.initCartesia = initCartesia;
})();
