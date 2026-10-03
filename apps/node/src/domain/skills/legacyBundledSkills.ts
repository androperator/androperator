import { createHash } from "node:crypto";
import { cp, lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// Exact complete file-tree fingerprints from first-party bundled-skills history
// through 616a29f6. Names or SKILL.md text alone never establish ownership.
const knownLegacyFingerprints: Record<string, string[]> = {
  "androperator-agent-orientation": [
    "518deb7dc18a4237025e67a6bacd7649c5f1f03e23866392995b45ef323f474c",
    "18d243ccf839844988db87067b1b8e8596dae0f06dec6a1c84955eebc282e2bc",
    "65ec1ab40b444fec795350b860e91ee664a67fed0ed1ce0ecbf749ac9ed40cb7",
    "6b765609853c97ab9e1d3a757d1ee66dbca4ae437ea1dd5c0416e0fc629aa621",
    "fb3f7c3aa840c5a1a0a59cadd194192f73d936ad3bd0a856fe5842a2824bf659",
    "fc195b3429b77ae71e159f9e4ecd4e14737c777c6f4272185c955822129d4004"
  ],
  "androperator-skill-author-by-recording": [
    "158cf6ad78045474d51a3e232587076367990cd6e3d4e213ed49728f932d5348",
    "480d3cc5709734d5f7945ede77f78cc10b91bd5204a8b7c10dd7d8d23a61a27e",
    "61a4b420d3b789759961805aeb59645883989bef396291cfd1aaa31551d7d1f3",
    "a884960a4752a8efd6c52a51d24561263b30ec9d934d7606771e4e78cf546334",
    "b66f62e9c716b26b42b87f51a65b35ef745924e520ab3ef4699fdd77883b7a36",
    "b931d454c4c7ed2d0b91b92b67a5a1f14793a20119559c5bfa790f20a7c2a90f"
  ],
  "androperator-upgrade": [
    "4aa701177311011db57dc09d3118c83c327cba14fcbed40c195eca6f0f650e5e",
    "0e6e39ea5699cfdb139f2088868e42c299ef595c54dfe813631d4d530aef9a3d",
    "2a151dbc591d8976cd6b535576c93a27094ac48599ed23e1fb305ae83128ad76",
    "2a89de2459839a2dbbf2f1ec85441f6d6ff5c61905185204c76d26b9e63b29b2",
    "83dd6e0ead26089e4edb120ce2ff565676963e5ca81fee2f41188720c16c00cc",
    "980ceb6d876420711a3b16bee02451942928599af00aeaf893b62bf8549fdea9",
    "e38b5b2aa3a62a6b7f98f9b9641c1e5ef94171bc013d2566e7f979e1320dba3b",
    "e6408f8774c8aa50aa43cfe35381f4cb289652e382f6c8d9fda23474ebbd2bc0"
  ],
  "androperator-skill-author-by-agent-discovery": [
    "96bf69b8267919be96b4184e40e8247a45576b4980fb00a9538ab67f4253db63",
    "1e16de66b6a88077d47c7b1f3fe3d96972bfac6ec67355d14e6b768de4bb8b3d",
    "34bc5e95c5e1f5b2e54f562325c74ded5b0e4db6ed3922d9009a5dafd977030e",
    "3c92067c655c759e4197e4ac8990e782f31aaa529fabf29bd3403612dfb415f4",
    "827ca5ca8749fbad3985a08e15717721e4bc349c1226b64c94da07fbf7fdfede",
    "9ae290ed0019742ba2d173beee10024747517dbeb7780f11597aa6780d9bf66f",
    "d4c309d1c63ac92da8c01f6c7480a76ea91e282cb1a7b6718b0f69f30c36f5bc"
  ]
};

async function knownLegacyFingerprint(path: string, skillName: string): Promise<string | undefined> {
  if (!Object.hasOwn(knownLegacyFingerprints, skillName)) return undefined;
  const known = knownLegacyFingerprints[skillName];
  const files: string[][] = [];
  async function visit(directory: string, prefix: string): Promise<boolean> {
    if (!(await lstat(directory)).isDirectory()) return false;
    const entries = await readdir(directory);
    if (entries.length === 0) return false;
    for (const name of entries.sort()) {
      const child = join(directory, name);
      const relative = prefix + name;
      const info = await lstat(child);
      if (info.isDirectory()) {
        if (!await visit(child, relative + "/")) return false;
      } else if (info.isFile()) {
        files.push([relative, createHash("sha256").update(await readFile(child)).digest("hex")]);
      } else return false;
    }
    return true;
  }
  try {
    if (!await visit(path, "")) return undefined;
    files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const fingerprint = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    return known.includes(fingerprint) ? fingerprint : undefined;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}


export async function isKnownLegacyBundledSkill(path: string, skillName: string): Promise<boolean> {
  return await knownLegacyFingerprint(path, skillName) !== undefined;
}

export async function moveLegacyBundledSkillToBackup(
  originalPath: string,
  backupPath: string,
  skillName: string,
  renameDirectory: typeof rename = rename
): Promise<void> {
  const fingerprint = await knownLegacyFingerprint(originalPath, skillName);
  if (fingerprint === undefined) throw new Error(`Legacy skill changed during installation: ${originalPath}`);
  try {
    await renameDirectory(originalPath, backupPath);
    return;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EXDEV")) throw error;
  }

  // rename cannot cross filesystems. Keep the original until the backup and
  // the still-existing source both match the exact tree we identified above.
  try {
    await cp(originalPath, backupPath, { recursive: true, force: false, errorOnExist: true, dereference: false });
    if (await knownLegacyFingerprint(backupPath, skillName) !== fingerprint
      || await knownLegacyFingerprint(originalPath, skillName) !== fingerprint) {
      throw new Error("Legacy skill content changed or backup verification failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Legacy backup failed; original preserved at ${originalPath}; backup path: ${backupPath}: ${message}`);
  }
  try {
    await rm(originalPath, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Verified legacy backup is at ${backupPath}, but removing ${originalPath} failed: ${message}`);
  }
}
