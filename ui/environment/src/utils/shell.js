export const escapeRegex = (value) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const buildWriteFileCommand = (path, content) => {
    const text = content === undefined || content === null ? '' : String(content)
    let marker = 'W7_EOF'
    let index = 0
    while (text.includes(marker)) {
        index += 1
        marker = `W7_EOF_${index}`
    }
    return `cat <<'${marker}' > ${path}\n${text}\n${marker}`
}

export const buildSedUpdateCommand = (file, entries) => {
    return entries.map((entry) => {
        const escapedKey = escapeRegex(entry.key)
        const escapedValue = String(entry.value ?? '').replace(/[/&]/g, '\\$&').replace(/\$/g, '\\$').replace(/"/g, '\\"')
        return `sed -i "s/^\\s*[;]*\\s*${escapedKey}\\s*=.*/${entry.key} = ${escapedValue}/" ${file}`
    }).join('\n')
}
