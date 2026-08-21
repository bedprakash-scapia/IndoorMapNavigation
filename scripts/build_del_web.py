"""Assemble web/del/index.html - the Delhi T3 wayfinder, one self-contained file."""
import os, re
ROOT = os.path.join(os.path.dirname(__file__), '..')
W = os.path.join(ROOT, 'web', 'del')
os.makedirs(W, exist_ok=True)
head = open(os.path.join(ROOT, 'web', 'mall', 'index.head.html')).read()
js = open(os.path.join(ROOT, 'web', 'mall', 'app.js')).read()
data = open(os.path.join(ROOT, 'venues', 'del', 'del_multi.json')).read()

head = head.replace('<title>Mall Wayfinder</title>', '<title>Delhi T3 Wayfinder</title>')
head = head.replace('<h1>Mall Wayfinder</h1>', '<h1>Delhi T3 Wayfinder</h1>')
head = head.replace('Directions built from a picture of the floor plan',
                    'Domestic Departures, built from a photo of the signboard')
head = head.replace('<span class="badge">3 floors &middot; trial</span>',
                    '<span class="badge">2 levels &middot; trial</span>')
head = re.sub(r'<p class="note"><b>How this was made\.</b>.*?</p>',
    '<p class="note"><b>How this was made.</b> From one photograph of the wayfinding '
    'board by the gate. The yellow concourse was lifted out of the picture, thinned to '
    'the line a person actually walks, and turned into a graph of 417 points across two '
    'levels. Shops were placed by hand: on this board many tenancies share a single red, '
    'so they cannot be told apart by colour the way a printed mall directory can. '
    'The board is photographed at an angle, so distances are indicative.</p>',
    head, flags=re.S)

# venue-specific example journeys
js = js.replace("""for (const [a, af, b, bf] of [["Hamley's", 'G', 'Zara Women', '1'],
                              ['HomeCentre', 'G', 'PVR', '2'],
                              ['Zara Women', '1', 'Food Court', '2'],
                              ['Starbucks', '1', 'Costa Coffee', 'G']]) {""",
"""for (const [a, af, b, bf] of [['Gates 27-36', 'D', 'Marks & Spencer', 'D'],
                              ['Croma', 'D', 'KFC', 'F'],
                              ["Haldiram's", 'D', 'Air India Lounge', 'F'],
                              ['Biba', 'D', 'Tumi', 'D']]) {""")
js = js.replace("const A0 = byName(\"Hamley's\", 'G'), Z0 = byName('Zara Women', '1');",
                "const A0 = byName('Gates 27-36', 'D'), Z0 = byName('Marks & Spencer', 'D');")

out = os.path.join(W, 'index.html')
open(out, 'w').write(head + '\n<script>\n' + js.replace('__MALL_DATA__', data) + '\n</script>\n')
print(f'web/del/index.html  {round(os.path.getsize(out)/1024)} KB')
