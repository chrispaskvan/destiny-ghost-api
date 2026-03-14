/**
 * @returns {number} - The current epoch time in seconds
 */
const getEpoch = () => {
    return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
};

export default getEpoch;