const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.RECRAFT_API_KEY || 'YT3UzMEsWXjQpLhWXdDE4SOC0vjwC5jLuoXjoDk6CFt4zEpk9DXRCkVGcJqU53HT';
const OUTPUT_DIR = path.join(__dirname, '../public/images');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const TASKS = [
  {
    filename: 'hero-dashboard-mockup.png',
    prompt: 'Ultra-clean minimalist 3D physical data-station concept for enterprise analytics, designed in the aesthetic of Apple and Dieter Rams. Layered sheets of frosted architectural glass and bead-blasted silver aluminum hovering slightly over a pure matte white surface. Subtle precise micro-engravings of geometric graph lines and delicate data points. Soft diffused morning studio lighting, gentle natural drop shadows, monochrome gray with very subtle royal blue accent, extremely sharp focus, editorial product photography, no text, no words, no letters, no typography, zero neon glow, 8k',
    style: 'realistic_image',
    size: '1820x1024'
  },
  {
    filename: 'security-api-vault.png',
    prompt: 'High-end industrial design photograph of a modern enterprise security node. A precision-milled dark titanium and smoked glass rectangular module, seamlessly integrated with a subtle physical mechanical lock cylinder and fine optical fiber conduits. Monochromatic deep slate and graphite tones with a single restrained emerald green indicator dot. Balanced architectural lighting, elegant studio still life, matte ceramic texture, no fantasy elements, no text, no letters, no numbers, photorealistic',
    style: 'realistic_image',
    size: '1024x1024'
  },
  {
    filename: 'ai-knowledge-evolution.png',
    prompt: 'Sculptural abstract data evolution structure made of satin-finished ceramic and precision-bent thin brass wires, representing continuous feedback loop and mathematical optimization. Clean Scandinavian design exhibition piece, isolated on an off-white background, soft uniform ambient lighting, neutral light gray shadows, organic yet engineered geometry, no floating futuristic particles, no glowing brains, no text, no letters, Hasselblad studio photograph',
    style: 'realistic_image',
    size: '1434x1024'
  },
  {
    filename: 'official-compliance-shield.png',
    prompt: 'Minimalist physical 3D crest emblem crafted from machined matte white porcelain and clear acrylic glass with beveled chamfered edges. Representing verified structural integrity and corporate compliance. Pure white and pale warm gray color palette, single directional daylight from top-left, sharp product design catalog photograph, no exaggerated sparks, no text, no badges, no logos, clean geometric perfection',
    style: 'realistic_image',
    size: '1434x1024'
  },
  {
    filename: 'multistream-pipeline.png',
    prompt: 'Three parallel ultra-thin brushed stainless steel tracks running through a minimalist architectural space, clean precision alignment, representing synchronized parallel workflows. Subtle frosted glass prisms along the channels refracting soft daylight into neutral white reflections. Industrial engineering perfection, Bauhaus minimalism, studio floor perspective, no rainbow gradients, no text, no letters, 8k photography',
    style: 'realistic_image',
    size: '1434x1024'
  },
  {
    filename: 'ai-radar-outreach.png',
    prompt: 'Close-up architectural macro shot of a precision-etched dark optical glass lens with micro-calibrated concentric circular measurement rings. Fine millimeter markings engraved into dark sapphire crystal, representing precision targeting and focus. Subtle deep navy hue, cold directional studio edge lighting, zero cartoonish radar screens, no text, no words, no UI fake icons, luxury watch instrument photography',
    style: 'realistic_image',
    size: '1434x1024'
  },
  {
    filename: 'aes256-vault-security.png',
    prompt: 'A heavy monolithic bank vault door detail, constructed from brushed dark tungsten steel and solid matte black composite alloy. Interlocking precision mechanical locking bolts, recessed heavy hinges, subtle industrial hairline finish, austere architectural lighting, feeling of absolute physical invulnerability, luxury hardware catalog, no laser beams, no sci-fi holograms, no text, no letters',
    style: 'realistic_image',
    size: '1434x1024'
  },
  {
    filename: 'spec-security.png',
    prompt: 'A minimalist solid matte-white ceramic shield sculpture with rounded corners, resting on a flat marble surface. Soft studio daylight, neutral gray shadows, Apple accessory aesthetic, pure clean form, no text, no letters, no glow',
    style: 'realistic_image',
    size: '1024x1024'
  },
  {
    filename: 'spec-council.png',
    prompt: 'Five minimalist solid frosted-glass architectural pillars arranged in a harmonious circular symposium formation on a light stone base, soft ambient lighting passing through translucent glass, Bauhaus geometric sculpture, no text, no letters',
    style: 'realistic_image',
    size: '1024x1024'
  },
  {
    filename: 'spec-satellite.png',
    prompt: 'A sleek aerodynamic aerospace fin component made of anodized silver aluminum, angled dynamically forward, sharp precision bevels, clean product photograph on white backdrop, minimal tech sculpture, no text, no flames, no letters',
    style: 'realistic_image',
    size: '1024x1024'
  }
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function generateSingleImage(task) {
  console.log(`\n⏳ Generating [${task.filename}]...`);
  const postData = JSON.stringify({
    prompt: task.prompt,
    style: task.style,
    size: task.size
  });

  const options = {
    hostname: 'external.api.recraft.ai',
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const json = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  if (!json.data || !json.data[0] || !json.data[0].url) {
    throw new Error(`API response error for ${task.filename}: ${JSON.stringify(json)}`);
  }

  const imageUrl = json.data[0].url;
  const outPath = path.join(OUTPUT_DIR, task.filename);
  console.log(`⬇️ Downloading to ${outPath}...`);
  await downloadFile(imageUrl, outPath);
  console.log(`✅ Saved [${task.filename}] successfully!`);
}

async function main() {
  console.log(`🚀 Starting Recraft.ai Batch Image Generation (${TASKS.length} assets)...`);
  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    try {
      await generateSingleImage(task);
    } catch (err) {
      console.error(`❌ Failed on ${task.filename}:`, err.message);
    }
  }
  console.log(`\n🎉 All image generation tasks finished!`);
}

main();
