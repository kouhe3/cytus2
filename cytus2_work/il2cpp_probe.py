#!/usr/bin/env python3
"""IL2CPP 反汇编探针：不依赖 IDA，直接读 libil2cpp.so。

用法：
    python il2cpp_probe.py 0x228D508             # 反汇编该地址 ~40 条
    python il2cpp_probe.py 0x228D508 80          # 指定条数
    python il2cpp_probe.py StoryEnding03Main     # 按 dump.cs 里的类名 / 方法名找地址

做的事：
  * 用 rva_map.json（dump.cs 解析出的 RVA → 方法名）标注 bl/b 目标
  * 用 .rela.dyn 把 `adrp+ldr` 的槽位解析成 script.json 里的
    `TypeInfo`（类）或字符串字面量（story step、SONG_ID 之类）

依赖：rva_map.json、il2cppdumper/script.json（都由 Il2CppDumper 产出）。
"""
import json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SO = os.path.join(HERE, "libil2cpp", "libil2cpp.so")
SCRIPT = os.path.join(HERE, "il2cppdumper", "script.json")
RVA_MAP = os.path.join(HERE, "rva_map.json")


def elf_sections(data):
    shoff = struct.unpack_from("<Q", data, 0x28)[0]
    shents = struct.unpack_from("<H", data, 0x3A)[0]
    shnum = struct.unpack_from("<H", data, 0x3C)[0]
    out = []
    for i in range(shnum):
        o = shoff + i * shents
        out.append(
            dict(
                type=struct.unpack_from("<I", data, o + 4)[0],
                addr=struct.unpack_from("<Q", data, o + 0x10)[0],
                off=struct.unpack_from("<Q", data, o + 0x18)[0],
                size=struct.unpack_from("<Q", data, o + 0x20)[0],
                entsize=struct.unpack_from("<Q", data, o + 0x38)[0],
            )
        )
    return out


def load():
    data = open(SO, "rb").read()
    secs = elf_sections(data)
    relocs = {}
    for s in secs:
        if s["type"] == 4 and s["entsize"]:
            for i in range(s["size"] // s["entsize"]):
                r_off, _, r_add = struct.unpack_from("<QQq", data, s["off"] + i * s["entsize"])
                relocs[r_off] = r_add
    script = json.load(open(SCRIPT, encoding="utf-8"))
    names = {e["Address"]: e["Name"] for e in script["ScriptMetadata"]}
    names.update({e["Address"]: repr(e["Value"]) for e in script["ScriptString"]})
    rvas = {int(k, 16): v for k, v in json.load(open(RVA_MAP, encoding="utf-8")).items()}
    return data, secs, relocs, names, rvas


def reader(data, secs):
    def read(va, n):
        for s in secs:
            if s["addr"] and s["addr"] <= va < s["addr"] + s["size"]:
                fo = s["off"] + va - s["addr"]
                return data[fo:fo + n]
        return data[va:va + n]

    return read


def find_by_name(rvas, needle):
    pat = re.compile(needle, re.I)
    return [(ea, name) for ea, name in sorted(rvas.items()) if pat.search(name)]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM

    target = sys.argv[1]
    data, secs, relocs, names, rvas = load()
    read = reader(data, secs)

    if target.lower().startswith("0x"):
        start = int(target, 16)
        label = rvas.get(start, "")
    else:
        hits = find_by_name(rvas, target)
        if not hits:
            sys.exit(f"rva_map 里找不到匹配 {target!r} 的方法")
        for ea, name in hits[:12]:
            print(f"{ea:#x}  {name}")
        if len(sys.argv) < 3 or not sys.argv[2].lower().startswith("0x"):
            sys.exit(0)
        start = int(sys.argv[2], 16)
        label = rvas.get(start, "")

    count = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else (
        int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 40
    )
    print(f"=== {start:#x}  {label}".rstrip())
    md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    adrp, notes = {}, []
    prev_ins = None
    for ins in md.disasm(read(start, count * 4), start):
        note = ""
        if ins.mnemonic == "adrp":
            reg, val = ins.op_str.split(", ")
            adrp[reg] = int(val[1:], 16)
        elif ins.mnemonic in ("ldr", "ldrb", "str", "strb") and "[" in ins.op_str:
            try:
                base = ins.op_str.split("[")[1].split(",")[0].strip("]")
                off_s = ins.op_str.split("#")[-1].rstrip("]")
                page = adrp.get(base)
                if page is not None:
                    slot = page + int(off_s, 16)
                    tgt = relocs.get(slot)
                    if tgt:
                        note = f"   ; {slot:#x} -> {names.get(tgt, hex(tgt))}"
            except (ValueError, IndexError):
                pass
        elif ins.mnemonic in ("bl", "b"):
            t = int(ins.op_str[1:], 16)
            note = "   -> " + (rvas.get(t) or f"{t:#x}")
        print(f"{ins.address:>10x}: {ins.mnemonic:8s} {ins.op_str}{note}")
        prev_ins = ins
    if notes:
        print("\n".join(notes))


if __name__ == "__main__":
    main()
