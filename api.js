const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'db_teste',
};

app.use(express.json());
app.use(cors());

const pool = mysql.createPool(dbConfig);

// Função para executar consultas no banco de dados
async function executeQuery(sql, values = []) {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.query(sql, values);
    return results;
  } catch (error) {
    throw error;
  } finally {
    connection.release(); // Liberar a conexão de volta para o pool
  }
}


// Rota para buscar todos os produtos
app.get('/produtos', async (req, res) => {
  try {
    // Consulta ao banco de dados para buscar todos os produtos
    const [rows] = await pool.query('SELECT * FROM produtos');
    res.status(200).json(rows); // Retorne os dados dos produtos como JSON
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Rota para buscar informações de Pagamento
app.get('/pagamentos', async (req, res) => {
  try {
    // Consulta ao banco de dados para buscar informações de Pagamento
    const [rows] = await pool.query('SELECT * FROM pagamentos');
    res.status(200).json(rows); // Retorne os dados de pagamento como JSON
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Rota para buscar informações da Empresa
app.get('/empresa', async (req, res) => {
  try {
    // Consulta ao banco de dados para buscar informações da empresa
    const [rows] = await pool.query('SELECT * FROM empresa');
    res.status(200).json(rows); // Retorne os dados da empresa como JSON
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.listen(port, () => {
  console.log(`Servidor API rodando na porta ${port}`);
});
