export function applyEnvironmentBuildImage(registry_server, imageName) {
    try {
        let imgTagInfo = imageName.split('-');
        if (imgTagInfo.length > 1) {
            const lastPart = imgTagInfo[imgTagInfo.length - 1];
            if (!isNaN(parseInt(lastPart)) && isFinite(lastPart)) {
                imgTagInfo.pop();
                imageName = imgTagInfo.join('-');
            }
        }
        const timestamp = Math.floor(Date.now() / 1000);
        let imgName = `${imageName}-${timestamp}`;
        let parsedURL = null
        try {
            parsedURL = new URL("http://" + imgName);
        } catch {
            parsedURL = null
        }
        if (parsedURL) {
            if (parsedURL.pathname) {
                imgName = parsedURL.pathname;
            }
        }
        imgName = imgName.replace(/^\/+/, '');

        return `${registry_server}/default/${imgName}`;

    } catch (err) {
        return {
            status: 500,
            message: err.message
        }
    }
}
