/**
 * @returns {number} - The current epoch time in seconds
 */
const getEpoch = () => {
    return Math.floor((new Date()).getTime() / 1000);
}

export default getEpoch;