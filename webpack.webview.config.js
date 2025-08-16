const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: {
      main: './src/webview/Apps/PR/index.tsx',
      commits: './src/webview/Apps/Commits/index.tsx',
    },
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? false : 'inline-source-map',
    output: {
      path: path.resolve(__dirname, 'dist', 'webview'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src/webview'),
        '@/components': path.resolve(__dirname, 'src/webview/components'),
        '@/pages': path.resolve(__dirname, 'src/webview/pages'),
        '@/hooks': path.resolve(__dirname, 'src/webview/hooks'),
        '@/types': path.resolve(__dirname, 'src/webview/types'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.webview.json'),
              transpileOnly: !isProduction,
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /module\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            {
              loader: 'css-loader',
              options: {
                modules: {
                  localIdentName: isProduction ? '[hash:base64:5]' : '[name]__[local]__[hash:base64:5]',
                },
              },
            },
          ],
        },
        {
          test: /\.css$/,
          exclude: /module\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/webview/Apps/PR/template.html'),
        filename: 'index.html',
        chunks: ['main'],
        inject: true,
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/webview/Apps/Commits/template.html'),
        filename: 'commits.html',
        chunks: ['commits'],
        inject: true,
      }),
      ...(isProduction
        ? [
            new MiniCssExtractPlugin({
              filename: '[name].[contenthash].css',
            }),
          ]
        : []),
    ],
    externals: {
      vscode: 'commonjs vscode',
    },
    performance: {
      hints: false,
    },
  };
};
