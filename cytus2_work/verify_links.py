import os, re, json, glob, collections
ROOT = "../cytus2_story"
STORY = os.path.join(ROOT, "story")
bad = []; links = 0
for p in glob.glob(os.path.join(STORY, "**", "*.md"), recursive=True):
    base = os.path.dirname(p)
    txt = open(p, encoding="utf-8").read()
    for m in re.finditer(r"\]\(([^)\s]+)\)", txt):
        t = m.group(1)
        if t.startswith("http") or t.startswith("#"): continue
        t = t.split("#")[0]
        links += 1
        tgt = os.path.normpath(os.path.join(base, t))
        if not os.path.exists(tgt):
            bad.append((os.path.relpath(p, STORY), t))
print("links", links, "broken", len(bad))
for b in bad[:15]: print("  BROKEN", b)

# coverage
im_seen = set(); os_seen = set()
for p in glob.glob(os.path.join(STORY, "**", "*.md"), recursive=True):
    txt = open(p, encoding="utf-8").read()
    im_seen |= set(re.findall(r"\.\./zh-Hans/im/([A-Z]\d{4})\.md", txt))
    os_seen |= set(re.findall(r"\.\./zh-Hans/os/[a-z0-9]+\.md", txt))
topics = [t["Id"].upper() for t in json.load(open("text/imdata/im_topic_data", encoding="utf-8"))]
print("im referenced", len(im_seen), "of", len(topics), "missing", sorted(set(topics) - im_seen)[:12])
