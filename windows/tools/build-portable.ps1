# Builds the portable Windows release of NeuroFly: the Electron runtime from
# node_modules, renamed and branded as NeuroFly.exe, with the tracked app files,
# the neural data and every licence notice. Nothing is installed or signed.
#
#   powershell -ExecutionPolicy Bypass -File windows\tools\build-portable.ps1 [-Out <dir>]
#
# Writes <Out>\NeuroFly-<version>-win-x64\ and <Out>\NeuroFly-<version>-win-x64.zip
# (default <Out>: a neurofly-build folder next to the repository).
param([string]$Out = '')
$ErrorActionPreference = 'Stop'

$win = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = (Resolve-Path (Join-Path $win '..')).Path
if (-not $Out) { $Out = Join-Path (Split-Path $root -Parent) 'neurofly-build' }
$pkg = Get-Content (Join-Path $win 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$name = "NeuroFly-$version-win-x64"
$stage = Join-Path $Out $name
$zip = "$stage.zip"
$dist = Join-Path $win 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $dist 'electron.exe'))) { throw 'Electron runtime missing: run npm install in windows\' }

# Only committed content goes into a release.
$paths = @('windows/main.js', 'windows/preload.cjs', 'windows/renderer', 'windows/src', 'windows/assets', 'data', 'LICENSE', 'THIRD_PARTY_NOTICES.md')
$dirty = git -C $root status --porcelain -- $paths
if ($dirty) { throw "Uncommitted changes in release files:`n$dirty" }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

# Electron runtime, without its default app.
Copy-Item (Join-Path $dist '*') $stage -Recurse
Remove-Item (Join-Path $stage 'resources\default_app.asar') -ErrorAction SilentlyContinue
Rename-Item (Join-Path $stage 'electron.exe') 'NeuroFly.exe'
Rename-Item (Join-Path $stage 'LICENSE') 'LICENSE.electron.txt'

# The app: tracked files only, private files excluded.
$app = Join-Path $stage 'resources\app'
$private = @('windows/assets/connectomes/research-inventory.json')
$files = git -C $root ls-files -- 'windows/main.js' 'windows/preload.cjs' 'windows/renderer' 'windows/src' 'windows/assets' 'data'
foreach ($f in $files) {
  if ($private -contains $f) { continue }
  $rel = if ($f.StartsWith('windows/')) { $f.Substring(8) } else { $f }
  $dest = Join-Path $app ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
  Copy-Item (Join-Path $root ($f -replace '/', '\')) $dest
}
$three = Join-Path $app 'node_modules\three'
New-Item -ItemType Directory -Force (Join-Path $three 'build') | Out-Null
foreach ($f in @('package.json', 'LICENSE', 'build\three.module.js')) { Copy-Item (Join-Path $win "node_modules\three\$f") (Join-Path $three $f) }
$appPkg = [ordered]@{ name = $pkg.name; productName = 'NeuroFly'; version = $version; description = $pkg.description
  type = 'module'; main = 'main.js'; author = $pkg.author; license = $pkg.license; homepage = $pkg.homepage }
[IO.File]::WriteAllText((Join-Path $app 'package.json'), ($appPkg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# Licences and a short readme next to the executable.
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt')
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $stage
$readme = @"
NeuroFly $version for Windows 10 and 11 (64-bit)
https://neurofly.app

Start: double-click NeuroFly.exe. Nothing is installed. To remove NeuroFly,
delete this folder; settings are kept in %APPDATA%\NeuroFly.

Windows may show "Windows protected your PC", because this build is not
code-signed: choose "More info", then "Run anyway".

NeuroFly runs entirely on this computer and makes no network connections.

Licences: LICENSE.txt (NeuroFly, PolyForm Noncommercial 1.0.0),
THIRD_PARTY_NOTICES.md, LICENSE.electron.txt and LICENSES.chromium.html.
Neural data: resources\app\data\DATA_LICENSE.md.
Software terms: https://neurofly.app/software-terms.html
Contact: contact@neurofly.app
"@
[IO.File]::WriteAllText((Join-Path $stage 'README.txt'), ($readme -replace "`r?`n", "`r`n"), (New-Object Text.UTF8Encoding $false))

# Brand the executable (icon and version information) with the Windows
# resource API, as rcedit does.
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class NfRes {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
  static void Put(IntPtr h, int type, int name, byte[] data) {
    if (!UpdateResource(h, (IntPtr)type, (IntPtr)name, 1033, data, (uint)data.Length)) throw new Exception("UpdateResource " + Marshal.GetLastWin32Error());
  }
  static void Pad(MemoryStream m) { while (m.Length % 4 != 0) m.WriteByte(0); }
  static byte[] Node(string key, byte[] value, ushort valueLength, ushort type, List<byte[]> children) {
    var m = new MemoryStream(); var w = new BinaryWriter(m);
    w.Write((ushort)0); w.Write(valueLength); w.Write(type);
    w.Write(Encoding.Unicode.GetBytes(key + "\0")); Pad(m);
    if (value != null) { w.Write(value); }
    if (children != null) foreach (var c in children) { Pad(m); w.Write(c); }
    var b = m.ToArray(); b[0] = (byte)(b.Length & 0xff); b[1] = (byte)(b.Length >> 8); return b;
  }
  static byte[] Str(string k, string v) { return Node(k, Encoding.Unicode.GetBytes(v + "\0"), (ushort)(v.Length + 1), 1, null); }
  public static void Apply(string exe, string ico, int[] ver, string[] strings) {
    // Electron's executable has icon images 1-4; NeuroFly's icon has at least as many.
    byte[] d = File.ReadAllBytes(ico); int n = BitConverter.ToUInt16(d, 4);
    if (n < 4) throw new Exception("icon needs at least 4 images");
    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new Exception("BeginUpdateResource " + Marshal.GetLastWin32Error());
    var grp = new MemoryStream(); var g = new BinaryWriter(grp);
    g.Write((ushort)0); g.Write((ushort)1); g.Write((ushort)n);
    for (int i = 0; i < n; i++) {
      int e = 6 + 16 * i; int size = BitConverter.ToInt32(d, e + 8), off = BitConverter.ToInt32(d, e + 12);
      byte[] img = new byte[size]; Array.Copy(d, off, img, 0, size); Put(h, 3, i + 1, img);
      g.Write(d, e, 12); g.Write((ushort)(i + 1));
    }
    Put(h, 14, 1, grp.ToArray());
    var fixedInfo = new MemoryStream(); var f = new BinaryWriter(fixedInfo);
    uint ms = (uint)((ver[0] << 16) | ver[1]), ls = (uint)((ver[2] << 16) | ver[3]);
    foreach (uint v in new uint[] { 0xFEEF04BD, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0 }) f.Write(v);
    var table = new List<byte[]>(); for (int i = 0; i < strings.Length; i += 2) table.Add(Str(strings[i], strings[i + 1]));
    var sfi = Node("StringFileInfo", null, 0, 1, new List<byte[]> { Node("040904b0", null, 0, 1, table) });
    var vfi = Node("VarFileInfo", null, 0, 1, new List<byte[]> { Node("Translation", BitConverter.GetBytes(0x04B00409), 4, 0, null) });
    Put(h, 16, 1, Node("VS_VERSION_INFO", fixedInfo.ToArray(), 52, 0, new List<byte[]> { sfi, vfi }));
    if (!EndUpdateResource(h, false)) throw new Exception("EndUpdateResource " + Marshal.GetLastWin32Error());
  }
}
"@
$v = ($version.Split('.') + @('0', '0', '0', '0'))[0..3] | ForEach-Object { [int]$_ }
[NfRes]::Apply((Join-Path $stage 'NeuroFly.exe'), (Join-Path $win 'assets\brand\neurofly-app-icon.ico'), $v, @(
  'CompanyName', 'NeuroFly', 'FileDescription', 'NeuroFly', 'FileVersion', "$version.0", 'InternalName', 'NeuroFly',
  'LegalCopyright', 'Copyright 2026 NeuroFly', 'OriginalFilename', 'NeuroFly.exe', 'ProductName', 'NeuroFly', 'ProductVersion', $version))

# Zip with the Windows tar (bsdtar), then fingerprint.
& "$env:WINDIR\System32\tar.exe" -a -c -f $zip -C $Out $name
if ($LASTEXITCODE) { throw "zip failed: $LASTEXITCODE" }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"{0}  {1}" -f $hash, (Split-Path $zip -Leaf) | Set-Content -Encoding ascii "$zip.sha256"
"built $zip ({0:N1} MB), sha256 $hash" -f ((Get-Item $zip).Length / 1MB)
