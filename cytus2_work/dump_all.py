import UnityPy, os, json, sys
src="ab"; out="text"; os.makedirs(out, exist_ok=True)
manifest={}
for fn in sorted(os.listdir(src)):
    if not fn.endswith(".ab"): continue
    p=os.path.join(src,fn)
    try:
        env=UnityPy.load(p)
    except Exception as e:
        print("FAIL",fn,e); continue
    items=[]
    for o in env.objects:
        if o.type.name!="TextAsset": continue
        d=o.read_typetree()
        name=d.get("m_Name") or str(o.path_id)
        s=d.get("m_Script")
        data=s.encode("utf-8","surrogateescape") if isinstance(s,str) else (bytes(s) if s else b"")
        safe="".join(c if c.isalnum() or c in "-_." else "_" for c in name)
        dd=os.path.join(out, fn[:-3]); os.makedirs(dd, exist_ok=True)
        open(os.path.join(dd,safe),"wb").write(data)
        items.append([name,len(data)])
    manifest[fn]=items
json.dump(manifest, open("text_manifest.json","w"), ensure_ascii=False, indent=1)
print("bundles", len(manifest), "textassets", sum(len(v) for v in manifest.values()))
