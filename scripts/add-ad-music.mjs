import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const input = path.join(root, "artifacts", "Ventra-Product-Advertising-EN.mp4");
const music = path.join(root, "artifacts", "ventra-ad-music.wav");
const output = path.join(root, "artifacts", "Ventra-Product-Advertising-EN-with-music.mp4");
const duration = 52;

// A restrained, low-volume synth bed: three warm chord tones, a slow pulse,
// and a soft high-frequency shimmer. It is deliberately quiet so a later
// human voiceover can sit above it without re-editing the video.
const pad = "0.045*sin(2*PI*110*t)+0.032*sin(2*PI*138.59*t)+0.024*sin(2*PI*164.81*t)+0.012*sin(2*PI*(220+8*sin(2*PI*t/9))*t)";
const pulse = "0.018*sin(2*PI*2*t)*(0.5+0.5*sin(2*PI*t/4))";
execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `aevalsrc=${pad}+${pulse}:s=48000:d=${duration}`, "-af", "afade=t=in:st=0:d=2,afade=t=out:st=47:d=5,volume=0.75", music], { stdio: "ignore" });
execFileSync("ffmpeg", ["-y", "-i", input, "-i", music, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", output], { stdio: "ignore" });
console.log(`Created ${output}`);
