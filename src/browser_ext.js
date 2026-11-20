const fs = require('fs');
const path = require('path');
const os = require('os');

const FULL_VER = "156.0.8078.80";
const MAJOR_VER = "156";
const WORKER_FN_SRC = "function workerStealthInit(CFG) {\n  try {\n    const defWorkerGetter = (proto, prop, val) => {\n      if (!proto) return;\n      const desc = Object.getOwnPropertyDescriptor(proto, prop);\n      if (!desc) return;\n      const origGet = desc.get;\n      const g = function() {\n        if (origGet) origGet.apply(this, arguments);\n        return val;\n      };\n      Object.defineProperty(g, 'name', { value: 'get ' + prop, configurable: true });\n      Object.defineProperty(proto, prop, {\n        get: g,\n        configurable: true,\n        enumerable: desc.enumerable\n      });\n    };\n    const navP = typeof WorkerNavigator !== 'undefined' ? WorkerNavigator.prototype : Object.getPrototypeOf(self.navigator);\n    defWorkerGetter(navP, 'userAgent', CFG.UA);\n    defWorkerGetter(navP, 'appVersion', CFG.APP_VER);\n    defWorkerGetter(navP, 'platform', 'Win32');\n    defWorkerGetter(navP, 'webdriver', false);\n    defWorkerGetter(navP, 'hardwareConcurrency', CFG.CORES);\n    defWorkerGetter(navP, 'deviceMemory', CFG.MEMORY);\n    defWorkerGetter(navP, 'language', 'ja');\n    defWorkerGetter(navP, 'languages', Object.freeze(['ja', 'en-US', 'en']));\n\n    if (typeof NavigatorUAData !== 'undefined' && NavigatorUAData.prototype) {\n      defWorkerGetter(NavigatorUAData.prototype, 'platform', 'Windows');\n      defWorkerGetter(NavigatorUAData.prototype, 'brands', CFG.BRANDS);\n      defWorkerGetter(NavigatorUAData.prototype, 'mobile', false);\n    }\n\n    const debugEnabled = new WeakSet();\n    const pgl = (pr, isGL2) => {\n      if (!pr) return;\n      if (pr.getSupportedExtensions) {\n        const oExts = pr.getSupportedExtensions;\n        pr.getSupportedExtensions = function() {\n          oExts.apply(this, arguments);\n          return (isGL2 ? CFG.EXTS_GL2 : CFG.EXTS_GL1).slice();\n        };\n      }\n      if (pr.getExtension) {\n        const oe = pr.getExtension;\n        pr.getExtension = function(name) {\n          const r = oe.apply(this, arguments);\n          if (String(name || '').toLowerCase() === 'webgl_debug_renderer_info' && r) {\n            debugEnabled.add(this);\n          }\n          return r;\n        };\n      }\n      if (pr.getParameter) {\n        const og = pr.getParameter;\n        pr.getParameter = function(p) {\n          if (p === 37445) {\n            if (!debugEnabled.has(this)) return og.apply(this, arguments);\n            og.apply(this, arguments);\n            return CFG.VENDOR;\n          }\n          if (p === 37446) {\n            if (!debugEnabled.has(this)) return og.apply(this, arguments);\n            og.apply(this, arguments);\n            return CFG.RENDERER;\n          }\n          const nr = og.apply(this, arguments);\n          if (p === 7936) return 'WebKit';\n          if (p === 7937) return 'WebKit WebGL';\n          if (p === 7938) return isGL2 ? 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' : 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';\n          if (p === 35724) return isGL2 ? 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)' : 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';\n          if (p === 33902) return new Float32Array([1, 1]);\n          if (p === 36349) return 1024;\n          return nr;\n        };\n      }\n    };\n    if (typeof WebGLRenderingContext !== 'undefined') pgl(WebGLRenderingContext.prototype, false);\n    if (typeof WebGL2RenderingContext !== 'undefined') pgl(WebGL2RenderingContext.prototype, true);\n  } catch (e) {}\n}";
const WINDOW_FN_SRC = "function windowStealthInit(CFG, workerFnSource) {\n  const patchedWindows = new WeakSet();\n  const globalNativeMap = new WeakMap();\n  const debugEnabledContexts = new WeakSet();\n  const NL = String.fromCharCode(10);\n\n  const applyAntidetectToWindow = (win) => {\n    if (!win || !win.navigator || patchedWindows.has(win)) return;\n    patchedWindows.add(win);\n\n    try {\n      const origToString = win.Function.prototype.toString;\n      const markNative = (fn, name) => {\n        if (typeof fn === 'function') {\n          const fnName = name !== undefined ? name : (fn.name || '');\n          try {\n            win.Object.defineProperty(fn, 'name', { value: fnName, configurable: true, writable: false, enumerable: false });\n          } catch (e) {}\n          globalNativeMap.set(fn, 'function ' + fnName + '() { [native code] }');\n        }\n        return fn;\n      };\n\n      win.Object.defineProperty(win.Function.prototype, 'toString', {\n        value: markNative(function toString() {\n          if (globalNativeMap.has(this)) return globalNativeMap.get(this);\n          return origToString.apply(this, arguments);\n        }, 'toString'),\n        writable: true,\n        configurable: true,\n        enumerable: false\n      });\n\n      const defGetter = (obj, prop, val) => {\n        if (!obj) return;\n        try {\n          const desc = win.Object.getOwnPropertyDescriptor(obj, prop);\n          if (!desc || !desc.get) return;\n          const origGet = desc.get;\n          const g = markNative(function() {\n            origGet.apply(this, arguments);\n            return val;\n          }, 'get ' + prop);\n          win.Object.defineProperty(obj, prop, {\n            get: g,\n            set: desc.set,\n            configurable: true,\n            enumerable: desc.enumerable\n          });\n        } catch (e) {}\n      };\n\n      // 1. Navigator / Screen / NavigatorUAData の完全 Windows 11 統一\n      const navProto = win.Navigator ? win.Navigator.prototype : win.Object.getPrototypeOf(win.navigator);\n      defGetter(navProto, 'userAgent', CFG.UA);\n      defGetter(navProto, 'appVersion', CFG.APP_VER);\n      defGetter(navProto, 'platform', 'Win32');\n      defGetter(navProto, 'webdriver', false);\n      defGetter(navProto, 'hardwareConcurrency', CFG.CORES);\n      defGetter(navProto, 'deviceMemory', CFG.MEMORY);\n      defGetter(navProto, 'maxTouchPoints', 0);\n      defGetter(navProto, 'language', 'ja');\n      defGetter(navProto, 'languages', win.Object.freeze(['ja', 'en-US', 'en']));\n\n      if (win.Screen && win.Screen.prototype) {\n        defGetter(win.Screen.prototype, 'availHeight', 1080);\n        defGetter(win.Screen.prototype, 'availWidth', 1920);\n        defGetter(win.Screen.prototype, 'availTop', 0);\n        defGetter(win.Screen.prototype, 'availLeft', 0);\n      }\n\n      if (win.NavigatorUAData && win.NavigatorUAData.prototype) {\n        defGetter(win.NavigatorUAData.prototype, 'brands', CFG.BRANDS);\n        defGetter(win.NavigatorUAData.prototype, 'mobile', false);\n        defGetter(win.NavigatorUAData.prototype, 'platform', 'Windows');\n        const origToJSON = win.NavigatorUAData.prototype.toJSON;\n        win.Object.defineProperty(win.NavigatorUAData.prototype, 'toJSON', {\n          value: markNative(function toJSON() {\n            if (origToJSON) origToJSON.apply(this, arguments);\n            return { brands: CFG.BRANDS, mobile: false, platform: 'Windows' };\n          }, 'toJSON'),\n          writable: true, configurable: true, enumerable: true\n        });\n        const origHighEntropy = win.NavigatorUAData.prototype.getHighEntropyValues;\n        win.Object.defineProperty(win.NavigatorUAData.prototype, 'getHighEntropyValues', {\n          value: markNative(async function getHighEntropyValues() {\n            if (origHighEntropy) await origHighEntropy.apply(this, arguments);\n            return {\n              architecture: 'x86', bitness: '64', brands: CFG.BRANDS, fullVersionList: CFG.FULL_LIST,\n              mobile: false, model: '', platform: 'Windows', platformVersion: '15.0.0',\n              uaFullVersion: CFG.FULL_VER, wow64: false\n            };\n          }, 'getHighEntropyValues'),\n          writable: true, configurable: true, enumerable: true\n        });\n      }\n\n      // 2. passkey_one_fa (Windows Hello) 対応\n      if (win.PublicKeyCredential) {\n        win.Object.defineProperty(win.PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', {\n          value: markNative(function isUserVerifyingPlatformAuthenticatorAvailable() {\n            return win.Promise.resolve(true);\n          }, 'isUserVerifyingPlatformAuthenticatorAvailable'),\n          writable: true, configurable: true\n        });\n        win.Object.defineProperty(win.PublicKeyCredential, 'isConditionalMediationAvailable', {\n          value: markNative(function isConditionalMediationAvailable() {\n            return win.Promise.resolve(true);\n          }, 'isConditionalMediationAvailable'),\n          writable: true, configurable: true\n        });\n      }\n\n      // 3. MediaDevices & SpeechSynthesis\n      if (win.navigator.mediaDevices && win.navigator.mediaDevices.enumerateDevices) {\n        const mdProto = win.Object.getPrototypeOf(win.navigator.mediaDevices);\n        const origEnum = mdProto.enumerateDevices;\n        win.Object.defineProperty(mdProto, 'enumerateDevices', {\n          value: markNative(async function enumerateDevices() {\n            if (origEnum) await origEnum.apply(this, arguments);\n            return [\n              { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'grp_' + CFG.DEV_SEED + '_1', toJSON() { return this; } },\n              { deviceId: 'cam_' + CFG.DEV_SEED + '_2', kind: 'videoinput', label: '', groupId: 'grp_' + CFG.DEV_SEED + '_2', toJSON() { return this; } },\n              { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'grp_' + CFG.DEV_SEED + '_1', toJSON() { return this; } }\n            ];\n          }, 'enumerateDevices'),\n          writable: true, configurable: true\n        });\n      }\n\n      if (win.speechSynthesis && typeof win.speechSynthesis.getVoices === 'function') {\n        const spProto = win.Object.getPrototypeOf(win.speechSynthesis);\n        const origVoices = spProto.getVoices;\n        const fakeVoices = win.Object.freeze([\n          win.Object.freeze({ default: true, lang: 'ja-JP', localService: true, name: 'Microsoft Ayumi - Japanese (Japan)', voiceURI: 'Microsoft Ayumi - Japanese (Japan)' }),\n          win.Object.freeze({ default: false, lang: 'ja-JP', localService: true, name: 'Microsoft Haruka - Japanese (Japan)', voiceURI: 'Microsoft Haruka - Japanese (Japan)' }),\n          win.Object.freeze({ default: false, lang: 'ja-JP', localService: true, name: 'Microsoft Ichiro - Japanese (Japan)', voiceURI: 'Microsoft Ichiro - Japanese (Japan)' }),\n          win.Object.freeze({ default: false, lang: 'en-US', localService: true, name: 'Microsoft David - English (United States)', voiceURI: 'Microsoft David - English (United States)' })\n        ]);\n        win.Object.defineProperty(spProto, 'getVoices', {\n          value: markNative(function getVoices() {\n            if (origVoices) origVoices.apply(this, arguments);\n            return fakeVoices;\n          }, 'getVoices'),\n          writable: true, configurable: true\n        });\n      }\n\n      // 4. WebGL / WebGL2: getSupportedExtensions 復元 ＋ INVALID_ENUM トラップ対策 ＋ Direct3D11 全定数同期\n      const patchGL = (proto, isGL2) => {\n        if (!proto) return;\n        if (proto.getSupportedExtensions) {\n          const origExts = proto.getSupportedExtensions;\n          win.Object.defineProperty(proto, 'getSupportedExtensions', {\n            value: markNative(function getSupportedExtensions() {\n              origExts.apply(this, arguments);\n              return (isGL2 ? CFG.EXTS_GL2 : CFG.EXTS_GL1).slice();\n            }, 'getSupportedExtensions'),\n            writable: true, configurable: true\n          });\n        }\n        if (proto.getExtension) {\n          const origExt = proto.getExtension;\n          win.Object.defineProperty(proto, 'getExtension', {\n            value: markNative(function getExtension(name) {\n              const res = origExt.apply(this, arguments);\n              if (String(name || '').toLowerCase() === 'webgl_debug_renderer_info' && res) {\n                debugEnabledContexts.add(this);\n              }\n              return res;\n            }, 'getExtension'),\n            writable: true, configurable: true\n          });\n        }\n        if (proto.getParameter) {\n          const orig = proto.getParameter;\n          win.Object.defineProperty(proto, 'getParameter', {\n            value: markNative(function getParameter(p) {\n              if (p === 37445) {\n                if (!debugEnabledContexts.has(this)) return orig.apply(this, arguments);\n                orig.apply(this, arguments);\n                return CFG.VENDOR;\n              }\n              if (p === 37446) {\n                if (!debugEnabledContexts.has(this)) return orig.apply(this, arguments);\n                orig.apply(this, arguments);\n                return CFG.RENDERER;\n              }\n              const nativeRes = orig.apply(this, arguments);\n              if (p === 7936) return 'WebKit';\n              if (p === 7937) return 'WebKit WebGL';\n              if (p === 7938) return isGL2 ? 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' : 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';\n              if (p === 35724) return isGL2 ? 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)' : 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';\n              if (p === 33902) return new win.Float32Array([1, 1]);\n              if (p === 33901) return new win.Float32Array([1, 1024]);\n              if (p === 36347) return 4096;\n              if (p === 36349) return 1024;\n              if (p === 3379) return 16384;\n              if (p === 34076) return 16384;\n              if (p === 34024) return 16384;\n              if (p === 3386) return new win.Int32Array([32767, 32767]);\n              return nativeRes;\n            }, 'getParameter'),\n            writable: true, configurable: true\n          });\n        }\n      };\n      if (win.WebGLRenderingContext) patchGL(win.WebGLRenderingContext.prototype, false);\n      if (win.WebGL2RenderingContext) patchGL(win.WebGL2RenderingContext.prototype, true);\n\n      // 5. AudioBuffer 全域固有化\n      if (win.AudioBuffer && win.AudioBuffer.prototype && win.AudioBuffer.prototype.getChannelData) {\n        const origGetChan = win.AudioBuffer.prototype.getChannelData;\n        const jitteredBuffers = new win.WeakSet();\n        win.Object.defineProperty(win.AudioBuffer.prototype, 'getChannelData', {\n          value: markNative(function getChannelData() {\n            const data = origGetChan.apply(this, arguments);\n            if (data && data.length > 20 && !jitteredBuffers.has(data)) {\n              jitteredBuffers.add(data);\n              for (let i = 0; i < data.length; i += 13) {\n                if (data[i] !== 0) {\n                  data[i] += CFG.A_JITTER * ((i % 5) - 2);\n                }\n              }\n            }\n            return data;\n          }, 'getChannelData'),\n          writable: true, configurable: true\n        });\n      }\n\n      // 6. 動的 iframe 同期フック\n      if (win.HTMLIFrameElement && win.HTMLIFrameElement.prototype) {\n        const cwDesc = win.Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'contentWindow');\n        const cdDesc = win.Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'contentDocument');\n        if (cwDesc && cwDesc.get) {\n          win.Object.defineProperty(win.HTMLIFrameElement.prototype, 'contentWindow', {\n            get: markNative(function() {\n              const cw = cwDesc.get.call(this);\n              if (cw) { try { applyAntidetectToWindow(cw); } catch (e) {} }\n              return cw;\n            }, 'get contentWindow'),\n            configurable: true, enumerable: true\n          });\n        }\n        if (cdDesc && cdDesc.get) {\n          win.Object.defineProperty(win.HTMLIFrameElement.prototype, 'contentDocument', {\n            get: markNative(function() {\n              const cd = cdDesc.get.call(this);\n              if (cd && cd.defaultView) { try { applyAntidetectToWindow(cd.defaultView); } catch (e) {} }\n              return cd;\n            }, 'get contentDocument'),\n            configurable: true, enumerable: true\n          });\n        }\n      }\n\n      // 7. Blob WebWorker 同期\n      const workerBootstrap = '(' + workerFnSource + ')(' + JSON.stringify(CFG) + ');' + NL;\n      if (win.Worker) {\n        const OrigWorker = win.Worker;\n        const WrappedWorker = markNative(function Worker(scriptURL, options) {\n          try {\n            const rawUrl = String(scriptURL || '');\n            const isModule = options && options.type === 'module';\n            if (!isModule && rawUrl.startsWith('blob:')) {\n              const xhr = new win.XMLHttpRequest();\n              xhr.open('GET', rawUrl, false);\n              xhr.send();\n              if (xhr.status === 200 || xhr.responseText) {\n                const patchedBlob = new win.Blob([workerBootstrap + xhr.responseText], { type: 'application/javascript' });\n                return new OrigWorker(win.URL.createObjectURL(patchedBlob), options);\n              }\n            }\n          } catch (e) {}\n          return new OrigWorker(scriptURL, options);\n        }, 'Worker');\n        WrappedWorker.prototype = OrigWorker.prototype;\n        win.Object.defineProperty(win, 'Worker', { value: WrappedWorker, writable: true, configurable: true });\n      }\n    } catch (e) {}\n  };\n\n  applyAntidetectToWindow(window);\n}";

function buildStealthExtensionDir(baseDir, devProf = {}, seedStr = '') {
  const extDir = path.join(baseDir, 'stealth_mv3_ext');
  fs.mkdirSync(extDir, { recursive: true });

  let hash = 0;
  const s = String(seedStr || Date.now() + Math.random());
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const absHash = Math.abs(hash);

  try {
    const fcDir = path.join(os.homedir(), ".config/fontconfig");
    fs.mkdirSync(fcDir, { recursive: true });
    const dpiVal = (96 + ((absHash % 19) * 0.05)).toFixed(2);
    const hintStyles = ["hintslight", "hintmedium", "hintfull"];
    const rgbaModes = ["rgb", "bgr"];
    const hs = hintStyles[absHash % hintStyles.length];
    const rgba = rgbaModes[(absHash >> 3) % rgbaModes.length];
    const fcXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <match target="font">
    <edit name="antialias" mode="assign"><bool>true</bool></edit>
    <edit name="hinting" mode="assign"><bool>true</bool></edit>
    <edit name="hintstyle" mode="assign"><const>${hs}</const></edit>
    <edit name="rgba" mode="assign"><const>${rgba}</const></edit>
  </match>
  <match target="pattern">
    <edit name="dpi" mode="assign"><double>${dpiVal}</double></edit>
  </match>
</fontconfig>`;
    fs.writeFileSync(path.join(fcDir, "fonts.conf"), fcXml, "utf8");
    const localFcDir = path.join(baseDir, ".config/fontconfig");
    fs.mkdirSync(localFcDir, { recursive: true });
    fs.writeFileSync(path.join(localFcDir, "fonts.conf"), fcXml, "utf8");
  } catch (e) {}

  const vendor = devProf.webglVendor || 'Google Inc. (NVIDIA)';
  const renderer = devProf.webglRenderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const cores = devProf.cores || [8, 12, 16][absHash % 3];
  const memory = devProf.memory || [8, 16, 32][absHash % 3];
  const nR = (absHash % 19) + 1;
  const nG = ((absHash >> 4) % 19) + 1;
  const nB = ((absHash >> 8) % 19) + 1;
  const audioJitter = ((absHash % 89) + 11) * 1e-7;
  const devIdSeed = absHash.toString(16).padStart(8, '0');

  const winUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR_VER}.0.0.0 Safari/537.36`;
  const secChUa = `"Not(A:Brand";v="99", "Google Chrome";v="${MAJOR_VER}", "Chromium";v="${MAJOR_VER}"`;
  const secChUaFullList = `"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="${FULL_VER}", "Chromium";v="${FULL_VER}"`;

  const rules = [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: winUserAgent },
          { header: 'Accept-Language', operation: 'set', value: 'ja,en-US;q=0.9,en;q=0.8' },
          { header: 'sec-ch-ua', operation: 'set', value: secChUa },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
          { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
          { header: 'sec-ch-ua-platform-version', operation: 'set', value: '"15.0.0"' },
          { header: 'sec-ch-ua-arch', operation: 'set', value: '"x86"' },
          { header: 'sec-ch-ua-bitness', operation: 'set', value: '"64"' },
          { header: 'sec-ch-ua-wow64', operation: 'set', value: '?0' },
          { header: 'sec-ch-ua-full-version-list', operation: 'set', value: secChUaFullList }
        ]
      },
      condition: {
        urlFilter: '*',
        resourceTypes: [
          'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
          'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
        ]
      }
    }
  ];

  const manifest = {
    manifest_version: 3,
    name: 'Windows 11 Native Engine Sync',
    version: '11.0.0',
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess'],
    host_permissions: ['<all_urls>'],
    declarative_net_request: {
      rule_resources: [{ id: 'win11_headers', enabled: true, path: 'rules.json' }]
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['inject.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true
      }
    ]
  };

  const CFG = {
    UA: winUserAgent,
    APP_VER: winUserAgent.replace('Mozilla/', ''),
    VENDOR: vendor,
    RENDERER: renderer,
    CORES: cores,
    MEMORY: memory,
    A_JITTER: audioJitter,
    DEV_SEED: devIdSeed,
    BRANDS: [
      { brand: 'Not(A:Brand', version: '99' },
      { brand: 'Google Chrome', version: MAJOR_VER },
      { brand: 'Chromium', version: MAJOR_VER }
    ],
    FULL_LIST: [
      { brand: 'Not(A:Brand', version: '99.0.0.0' },
      { brand: 'Google Chrome', version: FULL_VER },
      { brand: 'Chromium', version: FULL_VER }
    ],
    FULL_VER: FULL_VER,
    EXTS_GL1: [
      'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control', 'EXT_color_buffer_half_float',
      'EXT_depth_clamp', 'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_frag_depth',
      'EXT_polygon_offset_clamp', 'EXT_shader_texture_lod', 'EXT_texture_compression_bptc',
      'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge',
      'EXT_sRGB', 'KHR_parallel_shader_compile', 'OES_element_index_uint', 'OES_fbo_render_mipmap',
      'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
      'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_blend_func_extended',
      'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
      'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
      'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode'
    ],
    EXTS_GL2: [
      'EXT_clip_control', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_conservative_depth',
      'EXT_depth_clamp', 'EXT_disjoint_timer_query_webgl2', 'EXT_float_blend', 'EXT_polygon_offset_clamp',
      'EXT_render_snorm', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
      'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge', 'EXT_texture_norm16',
      'KHR_parallel_shader_compile', 'NV_shader_noperspective_interpolation', 'OES_draw_buffers_indexed',
      'OES_sample_variables', 'OES_shader_multisample_interpolation', 'OES_texture_float_linear',
      'OVR_multiview2', 'WEBGL_blend_func_extended', 'WEBGL_compressed_texture_s3tc',
      'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders',
      'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode', 'WEBGL_provoking_vertex'
    ]
  };

  const injectCode = '(' + WINDOW_FN_SRC + ')(' + JSON.stringify(CFG) + ', ' + JSON.stringify(WORKER_FN_SRC) + ');';
  new Function(injectCode);

  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(extDir, 'rules.json'), JSON.stringify(rules, null, 2), 'utf8');
  fs.writeFileSync(path.join(extDir, 'inject.js'), injectCode, 'utf8');
  return { extDir, renderer, nR, nG, nB, winUserAgent };
}

module.exports = { buildStealthExtensionDir };
