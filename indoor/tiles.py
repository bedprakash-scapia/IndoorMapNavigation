"""Minimal Mapbox Vector Tile decoder (no deps) - enough to pull POI id/name/level/geom."""
import struct, math

def varint(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s
        if not x & 0x80: return r, i
        s += 7

def fields(b, start=0, end=None):
    """Yield (field_number, wire_type, value_or_(off,len))."""
    i = start; end = len(b) if end is None else end
    while i < end:
        k, i = varint(b, i)
        fn, wt = k >> 3, k & 7
        if wt == 0:
            v, i = varint(b, i); yield fn, wt, v
        elif wt == 2:
            ln, i = varint(b, i); yield fn, wt, (i, ln); i += ln
        elif wt == 5:
            yield fn, wt, struct.unpack_from('<f', b, i)[0]; i += 4
        elif wt == 1:
            yield fn, wt, struct.unpack_from('<d', b, i)[0]; i += 8
        else:
            raise ValueError(f'wire type {wt}')

def zigzag(n): return (n >> 1) ^ -(n & 1)

def decode_value(b, off, ln):
    for fn, wt, v in fields(b, off, off + ln):
        if fn == 1: return b[v[0]:v[0]+v[1]].decode('utf8', 'replace')
        if fn in (2, 3): return v
        if fn == 4: return v
        if fn == 5: return v
        if fn == 6: return zigzag(v)
        if fn == 7: return bool(v)
    return None

def decode_geometry(cmds, extent, x, y, z):
    """Return list of rings/points in lon,lat."""
    n = 2 ** z; pts = []; i = 0; cx = cy = 0
    while i < len(cmds):
        c = cmds[i]; i += 1
        cid, cnt = c & 7, c >> 3
        if cid in (1, 2):
            for _ in range(cnt):
                cx += zigzag(cmds[i]); cy += zigzag(cmds[i+1]); i += 2
                lon = (x + cx / extent) / n * 360.0 - 180.0
                ly = math.pi * (1 - 2 * (y + cy / extent) / n)
                lat = math.degrees(math.atan(math.sinh(ly)))
                pts.append((round(lon, 7), round(lat, 7)))
        elif cid == 7:
            pass
    return pts

def decode_tile(buf, x, y, z):
    layers = {}
    for fn, wt, v in fields(buf):
        if fn != 3: continue
        off, ln = v
        name = None; keys = []; vals = []; feats = []; extent = 4096
        for f2, w2, v2 in fields(buf, off, off + ln):
            if f2 == 1: name = buf[v2[0]:v2[0]+v2[1]].decode('utf8', 'replace')
            elif f2 == 3: keys.append(buf[v2[0]:v2[0]+v2[1]].decode('utf8', 'replace'))
            elif f2 == 4: vals.append(decode_value(buf, v2[0], v2[1]))
            elif f2 == 5: extent = v2
            elif f2 == 2: feats.append(v2)
        out = []
        for foff, fln in feats:
            fid = None; tags = []; gtype = None; geom = []
            for f3, w3, v3 in fields(buf, foff, foff + fln):
                if f3 == 1: fid = v3
                elif f3 == 2:
                    if w3 == 2:
                        o, l = v3; j = o
                        while j < o + l:
                            t, j = varint(buf, j); tags.append(t)
                    else: tags.append(v3)
                elif f3 == 3: gtype = v3
                elif f3 == 4:
                    o, l = v3; j = o
                    while j < o + l:
                        t, j = varint(buf, j); geom.append(t)
            props = {}
            for a in range(0, len(tags) - 1, 2):
                try: props[keys[tags[a]]] = vals[tags[a+1]]
                except IndexError: pass
            pts = decode_geometry(geom, extent, x, y, z)
            out.append({'id': fid, 'type': gtype, 'props': props, 'pts': pts})
        layers[name] = out
    return layers
