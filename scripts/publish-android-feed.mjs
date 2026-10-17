import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

// Publish only AFTER uploading the immutable release asset. Never print credentials.
const [apkPath, metadataPath, tag, notesPath] = process.argv.slice(2);
if (!apkPath || !metadataPath || !tag || !notesPath) throw new Error('Usage: node scripts/publish-android-feed.mjs APK output-metadata.json RELEASE_TAG notes.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const entry = metadata.elements[0];
if (metadata.applicationId !== 'space.heisei.voicewriter' || !Number.isSafeInteger(entry.versionCode)) throw new Error('Invalid APK metadata');
const apk = readFileSync(apkPath);
const digest = createHash('sha256').update(apk).digest('hex');
const release = JSON.parse(execFileSync('gh', ['api', `repos/Pcerony/exhibition-audio-prototype/releases/tags/${tag}`], { encoding: 'utf8' }));
const asset = release.assets.find(asset => asset.name === basename(apkPath));
if (release.draft || !asset || asset.digest !== `sha256:${digest}` || asset.size !== apk.length) throw new Error('Uploaded release asset does not match local APK');
const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
for (const language of ['ja', 'zh', 'en']) if (typeof notes[language] !== 'string' || notes[language].length < 1 || notes[language].length > 4000) throw new Error('Missing release notes');
const manifest = { schemaVersion: 1, packageName: metadata.applicationId, versionCode: entry.versionCode, versionName: entry.versionName, minSdk: 26, url: asset.browser_download_url, size: apk.length, sha256: digest, notes };
writeFileSync('public/updates/android.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Verified ${entry.versionName} (${entry.versionCode}); feed generated. Commit and deploy Pages next.`);
