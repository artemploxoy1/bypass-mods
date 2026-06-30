function readVarInt(buffer, offset) {
    let value = 0;
    let size = 0;
    let b;
    do {
        b = buffer[offset + size];
        value |= (b & 0x7F) << (size * 7);
        size++;
    } while ((b & 0x80) !== 0);
    return { value, size };
}

function readString(buffer, offset) {
    const { value: length, size: varIntSize } = readVarInt(buffer, offset);
    const strOffset = offset + varIntSize;
    const str = buffer.toString('utf8', strOffset, strOffset + length);
    return { value: str, size: varIntSize + length };
}

function parseModList(buffer) {
    const mods = [];
    let offset = 1; // Пропускаем дискриминатор
    
    try {
        const { value: modCount, size: varIntSize } = readVarInt(buffer, offset);
        offset += varIntSize;

        for (let i = 0; i < modCount; i++) {
            if (offset >= buffer.length) break;
            
            const modIdResult = readString(buffer, offset);
            offset += modIdResult.size;

            const versionResult = readString(buffer, offset);
            offset += versionResult.size;

            mods.push({ id: modIdResult.value, version: versionResult.value });
        }
    } catch (e) {
        // Ошибка разбора структуры
    }
    return mods;
}

module.exports = { parseModList };