from pathlib import Path

replacements = {
    'Deep Web Research': 'Web Research',
    'Deep research': 'Web Research',
    'deep research': 'web research',
}

for filename in ['index.html', 'README.md', 'corefunctionality.md']:
    path = Path(filename)
    text = path.read_text(encoding='utf-8')
    original = text
    for old, new in replacements.items():
        text = text.replace(old, new)
    if filename == 'index.html':
        text = text.replace(
            'Allow the local model to use local tools plus several Tavily searches before answering',
            'Use local tools plus multiple Tavily searches before producing a final answer'
        )
    if text == original:
        print(f'No changes in {filename}')
    else:
        path.write_text(text, encoding='utf-8')
        print(f'Updated {filename}')
