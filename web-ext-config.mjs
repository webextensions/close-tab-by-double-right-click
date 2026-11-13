export default {
    // Default source for web-ext commands: the Firefox build from "npm run build:firefox". The Chrome scripts pass
    // "--source-dir dist/chrome" instead.
    sourceDir: 'dist/firefox',
    build: {
        overwriteDest: true
    }
};
