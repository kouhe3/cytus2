import json, glob, os, re
TAG=re.compile(r"</?(?:size|color|i|b|u|font_[0-9A-Za-z]+)(?:=[^>]*)?>")
SPK=re.compile(r"\*\*[^*]*\*\*[：:]")
def norm_md(s):
    s=TAG.sub("",s); s=SPK.sub("",s)
    s=re.sub(r"\*〔[^〕]*〕\*","",s)
    s=re.sub(r"^#{1,6} .*$","",s,flags=re.M)
    return re.sub(r"\s+","",s)
def norm_src(s):
    s=TAG.sub("",s or "")
    s=re.sub(r"</?p>","",s)
    s=re.sub(r"^##.*$","",s,flags=re.M)
    s=re.sub(r"^\{.*\}$","",s,flags=re.M)
    return re.sub(r"\s+","",s)
LANGS=[(0,"en"),(1,"ja"),(2,"zh-Hant"),(3,"ko"),(5,"zh-Hans")]
OUT="../cytus2_story"; miss=0; checked=0; ex=[]
def check(kind, src, md, tag):
    global miss,checked
    s=norm_src(src); checked+=1
    if s and s not in md:
        miss+=1
        if len(ex)<8: ex.append((tag,s[:70]))
mdcache={}
def md_of(code,path):
    k=(code,path)
    if k not in mdcache: mdcache[k]=norm_md(open(path,encoding="utf-8").read())
    return mdcache[k]
for f in glob.glob("text/imposts_*/posts"):
    p=json.load(open(f,encoding="utf-8")); tid=p["Id"].upper()
    for lang,code in LANGS:
        md=md_of(code,f"{OUT}/{code}/im/{tid}.md")
        for it in [p]+list(p.get("Replies") or []):
            check("im",(it.get("Contents") or [""]*6)[lang],md,f"IM {tid} {code}")
for fn in os.listdir("text/osdata"):
    if fn=="chapters": continue
    for e in json.load(open(f"text/osdata/{fn}",encoding="utf-8")):
        for lang,code in LANGS:
            v=(e.get("Contents") or [""]*6)[lang]
            if not isinstance(v,str): continue
            check("os",v,md_of(code,f"{OUT}/{code}/os/{fn}.md"),f"OS {fn} {e['Id']} {code}")
for fn in os.listdir("text/branchingosdata"):
    for e in json.load(open(f"text/branchingosdata/{fn}",encoding="utf-8")):
        for lang,code in LANGS:
            check("br",(e.get("Contents") or [""]*6)[lang],md_of(code,f"{OUT}/{code}/branching/{fn}.md"),f"BR {e['Id']} {code}")
print("checked",checked,"missing",miss)
for t,s in ex: print(t,s)
