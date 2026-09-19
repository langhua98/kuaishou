import json, urllib.request, urllib.parse, ssl
ctx=ssl.create_default_context()
def get(url):
    req=urllib.request.Request(url, headers={'User-Agent':'watch-duanju/1.0'})
    return urllib.request.urlopen(req, timeout=45, context=ctx).read()

def search(q, rows):
    p=urllib.parse.urlencode([('q',q),('fl[]','identifier'),('fl[]','title'),
                              ('rows',rows),('output','json'),('sort[]','downloads desc')])
    return json.loads(get('https://archive.org/advancedsearch.php?'+p))['response']['docs']

def pick_mp4(ident):
    """取该条目里体积适中的 h264 mp4"""
    try: m=json.loads(get('https://archive.org/metadata/'+ident))
    except Exception: return None
    best=None
    for f in m.get('files',[]):
        n=f.get('name','')
        if not n.lower().endswith('.mp4'): continue
        try: sz=int(f.get('size',0))
        except Exception: sz=0
        if sz < 300_000: continue                 # 太小多半是预览片段
        if best is None or sz < best[1]:          # 选最小的完整版，手表带宽友好
            best=(n, sz)
    if not best: return None
    return ('https://archive.org/download/%s/%s'
            % (ident, urllib.parse.quote(best[0])), best[1])

GROUPS=[('经典短片','collection:short_films AND mediatype:movies', 10),
        ('老牌剧集','collection:classic_tv AND mediatype:movies', 10),
        ('科幻惊悚','collection:SciFi_Horror AND mediatype:movies', 8)]

out=[]
for name,q,n in GROUPS:
    eps=[]
    for doc in search(q, n+6):
        if len(eps)>=n: break
        r=pick_mp4(doc['identifier'])
        if not r: continue
        url,sz=r
        eps.append({'n':len(eps)+1,'src':url,
                    'dur':'%.0f MB'%(sz/1048576),
                    'title':str(doc.get('title',''))[:40]})
    if eps:
        out.append({'id':name,'title':name,'tag':'archive.org · 公共领域 · %d 集'%len(eps),
                    'cover':'https://archive.org/services/img/'+search(q,1)[0]['identifier'],
                    'eps':eps})
        print('%s → %d 集' % (name, len(eps)))
json.dump(out, open('ia_cat.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
