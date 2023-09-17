const getMaxAgeFromCacheControl = header => {
    const maxAgeString = header.split('max-age=')[1];
    let maxAge;

    if (maxAgeString) {
        maxAge = parseInt(maxAgeString.split(',')[0], 10);
    }

    return Number.isNaN(maxAge) ? undefined : maxAge;
};

export default getMaxAgeFromCacheControl;
