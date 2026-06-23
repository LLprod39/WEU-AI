f = r'c:\work_ai\agent_projects\web_rA\servers\templates\servers\list.html'

with open(f, encoding='utf-8') as fp:
    content = fp.read()

# Fix grid + card size
old_grid = """    .server-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 14px;
        padding: 14px 16px;
        max-width: 1400px;
    }

    .server-card {
        background: rgba(17, 17, 21, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 14px;
        position: relative;
        transition: all 0.25s ease;
        overflow: hidden;
    }

    .server-card:hover {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(24, 24, 30, 0.95);
        transform: translateY(-1px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }"""

new_grid = """    .server-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: 14px;
        padding: 14px 16px;
    }

    @media (min-width: 900px) {
        .server-grid {
            grid-template-columns: repeat(auto-fill, minmax(290px, 420px));
        }
    }

    .server-card {
        background: rgba(17, 17, 21, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 14px;
        position: relative;
        transition: all 0.25s ease;
        overflow: hidden;
    }

    .server-card:hover {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(24, 24, 30, 0.95);
        transform: translateY(-1px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }"""

if old_grid in content:
    content = content.replace(old_grid, new_grid)
    print('Grid+card replaced')
else:
    print('Pattern not found')

with open(f, 'w', encoding='utf-8', newline='\n') as fp:
    fp.write(content)

print('Done')
