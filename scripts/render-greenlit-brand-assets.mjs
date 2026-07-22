import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, "artifacts/brand/greenlit-approved-source.png");
const publicBrandRoot = path.join(projectRoot, "apps/web/public/brand");
const appRoot = path.join(projectRoot, "apps/web/app");
const artifactRoot = path.join(projectRoot, "artifacts/brand");
const sourceBytes = await readFile(sourcePath);
const sourceDataUrl = `data:image/png;base64,${sourceBytes.toString("base64")}`;

await Promise.all([
  mkdir(publicBrandRoot, { recursive: true }),
  mkdir(appRoot, { recursive: true }),
  mkdir(artifactRoot, { recursive: true }),
]);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const rendered = await page.evaluate(async (dataUrl) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas is unavailable.");
  sourceContext.drawImage(image, 0, 0);
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);

  const corner = Math.max(8, Math.round(Math.min(source.width, source.height) * 0.02));
  const cornerSamples = [
    [0, 0],
    [source.width - corner, 0],
    [0, source.height - corner],
    [source.width - corner, source.height - corner],
  ];
  const background = [0, 0, 0];
  let backgroundSamples = 0;
  for (const [startX, startY] of cornerSamples) {
    for (let y = startY; y < startY + corner; y += 1) {
      for (let x = startX; x < startX + corner; x += 1) {
        const offset = (y * source.width + x) * 4;
        background[0] += sourcePixels.data[offset];
        background[1] += sourcePixels.data[offset + 1];
        background[2] += sourcePixels.data[offset + 2];
        backgroundSamples += 1;
      }
    }
  }
  background[0] = Math.round(background[0] / backgroundSamples);
  background[1] = Math.round(background[1] / backgroundSamples);
  background[2] = Math.round(background[2] / backgroundSamples);

  const distanceFromBackground = (red, green, blue) => Math.hypot(
    red - background[0],
    green - background[1],
    blue - background[2],
  );

  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      if (distanceFromBackground(
        sourcePixels.data[offset],
        sourcePixels.data[offset + 1],
        sourcePixels.data[offset + 2],
      ) > 34) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("Could not find the supplied logo in the source image.");

  const padding = 8;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(source.width - 1, maxX + padding);
  maxY = Math.min(source.height - 1, maxY + padding);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const croppedPixels = sourceContext.getImageData(minX, minY, cropWidth, cropHeight);

  const transparent = document.createElement("canvas");
  transparent.width = cropWidth;
  transparent.height = cropHeight;
  const transparentContext = transparent.getContext("2d", { willReadFrequently: true });
  if (!transparentContext) throw new Error("Canvas is unavailable.");
  const transparentPixels = transparentContext.createImageData(cropWidth, cropHeight);

  const inverse = document.createElement("canvas");
  inverse.width = cropWidth;
  inverse.height = cropHeight;
  const inverseContext = inverse.getContext("2d", { willReadFrequently: true });
  if (!inverseContext) throw new Error("Canvas is unavailable.");
  const inversePixels = inverseContext.createImageData(cropWidth, cropHeight);

  const inkSample = [0, 0, 0, 0];
  const greenSample = [0, 0, 0, 0];
  for (let offset = 0; offset < croppedPixels.data.length; offset += 4) {
    const red = croppedPixels.data[offset];
    const green = croppedPixels.data[offset + 1];
    const blue = croppedPixels.data[offset + 2];
    if (distanceFromBackground(red, green, blue) < 110) continue;
    const sample = green > red + 16 && green > blue + 18 ? greenSample : inkSample;
    sample[0] += red;
    sample[1] += green;
    sample[2] += blue;
    sample[3] += 1;
  }
  const averageSample = (sample) => sample.slice(0, 3).map((total) => Math.round(total / sample[3]));
  const ink = averageSample(inkSample);
  const mineralGreen = averageSample(greenSample);
  const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

  for (let offset = 0; offset < croppedPixels.data.length; offset += 4) {
    const red = croppedPixels.data[offset];
    const green = croppedPixels.data[offset + 1];
    const blue = croppedPixels.data[offset + 2];
    const isMineralGreen = green > red + 16 && green > blue + 18;
    const foreground = isMineralGreen ? mineralGreen : ink;
    const backgroundDelta = [
      background[0] - foreground[0],
      background[1] - foreground[1],
      background[2] - foreground[2],
    ];
    const observedDelta = [background[0] - red, background[1] - green, background[2] - blue];
    const denominator = backgroundDelta.reduce((sum, channel) => sum + channel * channel, 0);
    const coverage = Math.max(0, Math.min(1, observedDelta.reduce(
      (sum, channel, index) => sum + channel * backgroundDelta[index],
      0,
    ) / denominator));
    const alpha = coverage < 0.025 ? 0 : Math.round(coverage * 255);
    const unmix = (observed, backgroundChannel) => coverage > 0.025
      ? clampChannel((observed - (1 - coverage) * backgroundChannel) / coverage)
      : foreground[0];
    transparentPixels.data[offset] = unmix(red, background[0]);
    transparentPixels.data[offset + 1] = unmix(green, background[1]);
    transparentPixels.data[offset + 2] = unmix(blue, background[2]);
    transparentPixels.data[offset + 3] = alpha;

    inversePixels.data[offset] = isMineralGreen ? 115 : 255;
    inversePixels.data[offset + 1] = isMineralGreen ? 185 : 254;
    inversePixels.data[offset + 2] = isMineralGreen ? 147 : 250;
    inversePixels.data[offset + 3] = alpha;
  }
  transparentContext.putImageData(transparentPixels, 0, 0);
  inverseContext.putImageData(inversePixels, 0, 0);

  const activeColumns = new Array(cropWidth).fill(false);
  for (let x = 0; x < cropWidth; x += 1) {
    for (let y = 0; y < cropHeight; y += 1) {
      if (transparentPixels.data[(y * cropWidth + x) * 4 + 3] > 80) {
        activeColumns[x] = true;
        break;
      }
    }
  }
  const gaps = [];
  let gapStart = -1;
  for (let x = 0; x <= cropWidth; x += 1) {
    const empty = x < cropWidth && !activeColumns[x];
    if (empty && gapStart === -1) gapStart = x;
    if (!empty && gapStart !== -1) {
      const gapEnd = x - 1;
      if (gapStart > cropWidth * 0.12 && gapEnd < cropWidth * 0.7) gaps.push([gapStart, gapEnd]);
      gapStart = -1;
    }
  }
  gaps.sort((left, right) => (right[1] - right[0]) - (left[1] - left[0]));
  const logoGap = gaps[0];
  if (!logoGap || logoGap[1] - logoGap[0] < 8) throw new Error("Could not separate the approved symbol from its wordmark.");
  const markWidth = logoGap[0];

  const toPngDataUrl = (canvas) => canvas.toDataURL("image/png");
  const fitCanvas = (content, width, height, paddingX = 8, paddingY = 8, backgroundColor = null) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    if (backgroundColor) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min((width - paddingX * 2) / content.width, (height - paddingY * 2) / content.height);
    const drawWidth = content.width * scale;
    const drawHeight = content.height * scale;
    context.drawImage(content, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return canvas;
  };

  const mark = document.createElement("canvas");
  mark.width = markWidth;
  mark.height = cropHeight;
  const markContext = mark.getContext("2d");
  if (!markContext) throw new Error("Canvas is unavailable.");
  markContext.drawImage(transparent, 0, 0, markWidth, cropHeight, 0, 0, markWidth, cropHeight);

  const inverseMark = document.createElement("canvas");
  inverseMark.width = markWidth;
  inverseMark.height = cropHeight;
  const inverseMarkContext = inverseMark.getContext("2d");
  if (!inverseMarkContext) throw new Error("Canvas is unavailable.");
  inverseMarkContext.drawImage(inverse, 0, 0, markWidth, cropHeight, 0, 0, markWidth, cropHeight);

  const logo = fitCanvas(transparent, 1200, 270, 8, 8);
  const inverseLogo = fitCanvas(inverse, 1200, 270, 8, 8);
  const mark512 = fitCanvas(mark, 512, 512, 44, 44);
  const inverseMark512 = fitCanvas(inverseMark, 512, 512, 44, 44);
  const mark192 = fitCanvas(mark, 192, 192, 17, 17);
  const mark64 = fitCanvas(mark, 64, 64, 5, 5);
  const appIcon = fitCanvas(mark, 512, 512, 58, 58, `rgb(${background.join(",")})`);
  const appleIcon = fitCanvas(mark, 180, 180, 20, 20, `rgb(${background.join(",")})`);

  const social = document.createElement("canvas");
  social.width = 1200;
  social.height = 630;
  const socialContext = social.getContext("2d");
  if (!socialContext) throw new Error("Canvas is unavailable.");
  socialContext.fillStyle = `rgb(${background.join(",")})`;
  socialContext.fillRect(0, 0, social.width, social.height);
  const socialScale = Math.min(social.width / image.naturalWidth, social.height / image.naturalHeight);
  const socialWidth = image.naturalWidth * socialScale;
  const socialHeight = image.naturalHeight * socialScale;
  socialContext.drawImage(image, (social.width - socialWidth) / 2, (social.height - socialHeight) / 2, socialWidth, socialHeight);

  return {
    logo: toPngDataUrl(logo),
    inverseLogo: toPngDataUrl(inverseLogo),
    mark512: toPngDataUrl(mark512),
    inverseMark512: toPngDataUrl(inverseMark512),
    mark192: toPngDataUrl(mark192),
    mark64: toPngDataUrl(mark64),
    appIcon: toPngDataUrl(appIcon),
    appleIcon: toPngDataUrl(appleIcon),
    social: toPngDataUrl(social),
    diagnostics: {
      source: { width: image.naturalWidth, height: image.naturalHeight },
      background,
      crop: { x: minX, y: minY, width: cropWidth, height: cropHeight },
      symbolWordmarkGap: { start: logoGap[0], end: logoGap[1] },
    },
  };
}, sourceDataUrl);

const pngBytes = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

await Promise.all([
  writeFile(path.join(publicBrandRoot, "greenlit-logo.png"), pngBytes(rendered.logo)),
  writeFile(path.join(publicBrandRoot, "greenlit-logo-inverse.png"), pngBytes(rendered.inverseLogo)),
  writeFile(path.join(publicBrandRoot, "greenlit-mark.png"), pngBytes(rendered.mark512)),
  writeFile(path.join(publicBrandRoot, "greenlit-mark-inverse.png"), pngBytes(rendered.inverseMark512)),
  writeFile(path.join(publicBrandRoot, "greenlit-mark-192.png"), pngBytes(rendered.mark192)),
  writeFile(path.join(publicBrandRoot, "greenlit-mark-512.png"), pngBytes(rendered.appIcon)),
  writeFile(path.join(publicBrandRoot, "greenlit-social-card.png"), pngBytes(rendered.social)),
  writeFile(path.join(appRoot, "icon.png"), pngBytes(rendered.mark64)),
  writeFile(path.join(appRoot, "apple-icon.png"), pngBytes(rendered.appleIcon)),
  writeFile(path.join(artifactRoot, "greenlit-logo-transparent.png"), pngBytes(rendered.logo)),
  writeFile(path.join(artifactRoot, "greenlit-mark-512.png"), pngBytes(rendered.mark512)),
]);

await writeFile(path.join(artifactRoot, "asset-report.json"), `${JSON.stringify({
  approvedSourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  ...rendered.diagnostics,
}, null, 2)}\n`);

await page.close();
await browser.close();

console.log(JSON.stringify(rendered.diagnostics, null, 2));
