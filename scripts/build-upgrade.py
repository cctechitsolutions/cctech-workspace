from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'supabase'
names = [
    '003_supplier_whatsapp.sql', '004_whatsapp_inbox.sql',
    '005_order_workflow.sql', '006_approved_business_rules.sql',
    '007_channel_connections.sql', '008_conversation_processing.sql',
    '009_vendor_groups.sql',
]
parts = []
for name in names:
    text = (root / 'migrations' / name).read_text(encoding='utf-8').strip()
    if text.startswith('begin;'):
        text = text[len('begin;'):]
    if text.endswith('commit;'):
        text = text[:-len('commit;')]
    parts.append('-- ' + name + '\n' + text.strip())
target = root / 'upgrade-workspace.sql'
target.write_text(
    '-- CCTech existing-project upgrade: RUN ONCE after migrations 001 and 002.\n'
    '-- Retains suppliers/enquiries. Creates approved rules and private channel integration.\n'
    '-- Does not connect Meta, deploy functions, book couriers or send messages.\n'
    'begin;\n\n' + '\n\n'.join(parts) + '\n\ncommit;\n', encoding='utf-8',
)
print(target)
