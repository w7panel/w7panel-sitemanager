import panelAxios from "@/utils/panel"

export const reloadEnvironment = (environmentName) => {
    return panelAxios.patch("/apis/apps/v1/namespaces/default/deployments/" + environmentName, {
        spec: {
            template: {
                metadata: { labels: { reload: String(Date.now()) } }
            }
        }
    }, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    })
}

export const envLog = (environmentName, imageName, imageList) => {
    window.$wujie.bus.$emit('podLog', {
        name: environmentName,
        container: imageName,
        containerList: imageList
    })
}

export const terminal = (environmentName, imageName) => {
    window.$wujie.bus.$emit('openPage', {
        title: '终端命令',
        src: `/dialog/pod-webshell?pod=${imageName}&namespace=default&containerName=${environmentName}&type=bin/sh`
    })
}

export const getPods = (environmentName) => {
    return panelAxios.get("/api/v1/namespaces/default/pods?labelSelector=app=" + environmentName)
}

const PATH_TOKEN_REGEX = /[^.[\]]+|\[(?:(-?\d+)|'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)")\]/g

const isPlainObject = (value) => {
    return Object.prototype.toString.call(value) === '[object Object]'
}

const cloneValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(item => cloneValue(item))
    }

    if (isPlainObject(value)) {
        return Object.keys(value).reduce((result, key) => {
            result[key] = cloneValue(value[key])
            return result
        }, {})
    }

    return value
}

const parsePath = (path) => {
    if (typeof path !== 'string' || !path.trim()) {
        return []
    }

    const tokens = []
    path.replace(PATH_TOKEN_REGEX, (match, numberToken, singleQuoteToken, doubleQuoteToken) => {
        if (numberToken !== undefined) {
            tokens.push(Number(numberToken))
        } else if (singleQuoteToken !== undefined) {
            tokens.push(singleQuoteToken.replace(/\\'/g, "'"))
        } else if (doubleQuoteToken !== undefined) {
            tokens.push(doubleQuoteToken.replace(/\\"/g, '"'))
        } else {
            tokens.push(match)
        }

        return match
    })

    return tokens
}

const parseTargetRule = (target) => {
    if (typeof target !== 'string') {
        return {
            path: [],
            pickIndexes: [],
        }
    }

    const matched = target.match(/^(.*)\[(\s*\d+\s*,\s*\d+(?:\s*,\s*\d+)*)\]\s*$/)
    if (!matched) {
        return {
            path: parsePath(target),
            pickIndexes: [],
        }
    }

    return {
        path: parsePath(matched[1]),
        pickIndexes: matched[2].split(',').map(item => Number(item.trim())).filter(item => !Number.isNaN(item)),
    }
}

const getValueByPath = (source, pathTokens) => {
    return pathTokens.reduce((result, token) => {
        if (result === undefined || result === null) {
            return undefined
        }

        return result[token]
    }, source)
}

const ensureContainer = (nextToken) => {
    return typeof nextToken === 'number' ? [] : {}
}

const setValueByPath = (source, pathTokens, value) => {
    if (!pathTokens.length) {
        return
    }

    let current = source
    for (let index = 0; index < pathTokens.length - 1; index += 1) {
        const token = pathTokens[index]
        const nextToken = pathTokens[index + 1]

        if (current[token] === undefined || current[token] === null) {
            current[token] = ensureContainer(nextToken)
        }

        current = current[token]
    }

    current[pathTokens[pathTokens.length - 1]] = value
}

const isAnnotationPath = (pathTokens) => {
    return pathTokens.includes('annotations')
}

const normalizeListItem = (item) => {
    if (item === undefined || item === null) {
        return ''
    }

    if (typeof item === 'string') {
        return item.trim()
    }

    return item
}

const getUniqueKey = (item) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null || item === undefined) {
        return String(item)
    }

    return JSON.stringify(item)
}

const mergeUniqueList = (currentList, nextList) => {
    const merged = []
    const seen = new Set()

    currentList.concat(nextList).forEach(item => {
        const normalizedItem = normalizeListItem(item)
        if (normalizedItem === '') {
            return
        }

        const uniqueKey = getUniqueKey(normalizedItem)
        if (seen.has(uniqueKey)) {
            return
        }

        seen.add(uniqueKey)
        merged.push(cloneValue(normalizedItem))
    })

    return merged
}

const splitCommaString = (value) => {
    return String(value)
        .split(',')
        .map(item => item.trim())
        .filter(item => item !== '')
}

const pickSourceValue = (value, pickIndexes) => {
    if (!pickIndexes.length) {
        return cloneValue(value)
    }

    if (Array.isArray(value)) {
        return pickIndexes.map(index => value[index]).filter(item => item !== undefined)
    }

    if (typeof value === 'string') {
        const parts = value.split(/[/:@]/).map(item => item.trim()).filter(item => item !== '')
        return pickIndexes.map(index => parts[index]).filter(item => item !== undefined)
    }

    return cloneValue(value)
}

const normalizeIncomingValue = (value, currentValue, pathTokens) => {
    const shouldUseCommaString = isAnnotationPath(pathTokens) || typeof currentValue === 'string'
    if (Array.isArray(value) && shouldUseCommaString) {
        return mergeUniqueList([], value).join(',')
    }

    return cloneValue(value)
}

const mergeValue = (currentValue, incomingValue, pathTokens) => {
    if (currentValue === undefined || currentValue === null || currentValue === '') {
        return normalizeIncomingValue(incomingValue, currentValue, pathTokens)
    }

    if (Array.isArray(currentValue)) {
        const nextList = Array.isArray(incomingValue) ? incomingValue : [incomingValue]
        return mergeUniqueList(currentValue, nextList)
    }

    if (typeof currentValue === 'string') {
        const currentList = splitCommaString(currentValue)
        const nextList = Array.isArray(incomingValue)
            ? incomingValue
            : (typeof incomingValue === 'string' ? splitCommaString(incomingValue) : [incomingValue])
        return mergeUniqueList(currentList, nextList).join(',')
    }

    if (isPlainObject(currentValue) && isPlainObject(incomingValue)) {
        return {
            ...currentValue,
            ...incomingValue,
        }
    }

    return cloneValue(incomingValue)
}

export const fillData = (data, autoFillRules, sourceData) => {
    let rules = autoFillRules

    if (typeof rules === 'string') {
        try {
            rules = JSON.parse(rules)
        } catch (error) {
            return data
        }
    }

    if (!Array.isArray(rules)) {
        return data
    }

    rules.forEach(rule => {
        const sourcePath = parsePath(rule?.source)
        const targetRule = parseTargetRule(rule?.target)

        if (!sourcePath.length || !targetRule.path.length) {
            return
        }

        const sourceValue = getValueByPath(sourceData, sourcePath)
        if (sourceValue === undefined || sourceValue === null || sourceValue === '') {
            return
        }

        const incomingValue = pickSourceValue(sourceValue, targetRule.pickIndexes)
        if (Array.isArray(incomingValue) && !incomingValue.length) {
            return
        }

        const currentValue = getValueByPath(sourceData, targetRule.path)
        const mergedValue = mergeValue(currentValue, incomingValue, targetRule.path)
        setValueByPath(data, targetRule.path, mergedValue)
    })

    return data
}
