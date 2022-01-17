const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const publicDir = path.resolve(__dirname, 'public');

module.exports = (env, argv) => {
  let emulatorOptions = null;
  if (argv.emulatorConfig) {
    emulatorOptions = require(argv.emulatorConfig).emulators;
  }
  const config = {
    plugins: [
      new MiniCssExtractPlugin(),
      new webpack.DefinePlugin({
        EMULATOR_OPTIONS: JSON.stringify(emulatorOptions),
      }),
    ],
    devtool: 'inline-source-map',
    entry: {
      bundle: './src/index.ts',
    },
    module: {
      rules: [
        {
          test: /\.styl/,
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
              options: {
                hmr: argv.mode !== 'production',
              },
            },
            'css-loader',
            'postcss-loader',
            'stylus-loader',
          ],
        },
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      path: publicDir,
    },
    devServer: {
      port: 8081,
      hot: true,
      contentBase: publicDir,
      historyApiFallback: true,
      proxy: emulatorOptions
        ? {
            '/__':
              'http://' +
              emulatorOptions.hosting.host +
              ':' +
              emulatorOptions.hosting.port +
              '/',
          }
        : {},
      watchContentBase: false,
    },
  };
  if (argv.mode === 'production') {
    delete config.devtool;
  }
  return config;
};
