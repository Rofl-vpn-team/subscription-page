import { joinURL, parseURL, stringifyParsedURL } from 'ufo'

const prepareSubscriptionUrl = (currentUrl: string) => {
    const url = parseURL(currentUrl)

    url.search = ''
    url.hash = ''
    url.auth = ''

    return url
}

export const constructSubscriptionUrl = (currentUrl: string, shortUuid: string): string => {
    const url = prepareSubscriptionUrl(currentUrl)

    const segments = url.pathname.split('/').filter(Boolean)
    const lastSegment = segments.at(-1)

    if (lastSegment !== shortUuid) {
        segments.pop()
        segments.push(shortUuid)
        url.pathname = joinURL('/', ...segments)
    }

    return stringifyParsedURL(url)
}

export const constructMihomoSubscriptionUrl = (
    currentUrl: string,
    mainShortUuid: string
): string => {
    const url = prepareSubscriptionUrl(currentUrl)
    const segments = url.pathname.split('/').filter(Boolean)

    if (segments.at(-1) === mainShortUuid) {
        segments.pop()
    }

    if (segments.at(-1) === 'mihomo') {
        segments.pop()
    }

    segments.push('mihomo', mainShortUuid)
    url.pathname = joinURL('/', ...segments)

    return stringifyParsedURL(url)
}
