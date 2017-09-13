var path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'xapi-statement-builder.js',
        library: 'xapiStatementBuilder',
        libraryTarget: 'umd'
    }
};
